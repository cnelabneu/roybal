//data_collect.js

// Fitbit API access token and refresh token
let access_token;
let refresh_token;

fetch('/api/tokens')
    .then(response => response.json())
    .then(data => {
        access_token = data.access_token;
        refresh_token = data.refresh_token;

        // Use the tokens as needed
    })
    .catch(error => console.error('Error:', error));

function refreshAccessToken() {
    return fetch('https://api.fitbit.com/oauth2/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic MjNSQ1hEOmYxZDRiZmYzZmNhZmEwM2UxYzkyMDA5NDEyMjI0YjI2'
        },
        body: `grant_type=refresh_token&refresh_token=${refresh_token}`
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.access_token) {
                access_token = data.access_token; // Update the access token
                if (data.refresh_token) {
                    refresh_token = data.refresh_token; // Update the refresh token
                }
                return access_token;
            } else {
                throw new Error('Unable to refresh access token');
            }
        })
        .catch(error => console.error('Error:', error));
}

let apiData = []; // Store the data from API calls

//Calls the Fitbit API to get the user's steps for the last 7 days
function dailyActivityCollect(clientId) {
    const today = new Date().toISOString().slice(0, 10); // Get today's date in YYYY-MM-DD format

    console.log('Making API call with access token:', access_token + " " + refresh_token);
    return fetch(`https://api.fitbit.com/1/user/${clientId}/activities/date/${today}.json`, {
        method: "GET",
        headers: { "Authorization": "Bearer " + access_token }
    })
        .then(response => {
            if (response.status === 401) {
                return refreshAccessToken().then(() => dailyActivityCollect(clientId));
            }
            return response.json();
        })
        .then(json => {
            apiData.push(json);
        })
        .catch(error => console.error(error));
}

function flattenObject(obj, parentKey = '', result = {}) {
    for (const key in obj) {
        let propName = parentKey ? `${parentKey}_${key}` : key;

        if (key === "distances" && Array.isArray(obj[key])) {
            const distanceNames = ['total', 'tracker', 'loggedActivities', 'veryActive', 'moderatelyActive', 'lightlyActive', 'sedentaryActive'];
            obj[key].forEach((distance, index) => {
                result[propName + "_" + distanceNames[index]] = distance.distance;
            });
        } else if (typeof obj[key] === 'object') {
            flattenObject(obj[key], propName, result);
        } else {
            result[propName] = obj[key];
        }
    }
    return result;
}


function generateCSV() {
    let csvData = "";

    // Assuming apiData contains only one item
    const summary = apiData[0].summary;

    const flattenedSummary = flattenObject(summary);

    // Extract headers
    const headers = Object.keys(flattenedSummary);

    // Add headers to CSV and add date header after
    csvData += headers.join(',') + ',date\n';
    
    // Add values to CSV and add date value after
    const values = headers.map(header => flattenedSummary[header]);
    csvData += values.join(',') + ',' + new Date().toISOString().slice(0, 10) + '\n';

    // Create a Blob with the CSV data
    const blob = new Blob([csvData], { type: 'text/csv' });

    // Create a download link for the CSV file
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fitbit_data.csv';

    // Trigger the download
    a.click();

    // Release the URL object
    window.URL.revokeObjectURL(url);
}


function handleButtonClick() {
    // Fetch data from the Fitbit API
    dailyActivityCollect("BPS5WQ")
        .then(() => generateCSV())
        .catch(error => console.error(error));
}


// Attach the click event handler to the button
document.getElementById("generateCsvButton").addEventListener("click", handleButtonClick);
