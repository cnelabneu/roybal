//index.js
const express = require('express');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const app = express();
const path = require('path');
const fetch = require('node-fetch');
const dotenv = require('dotenv');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const publicPath = '/assets'; // Set the correct public path
app.use(publicPath, express.static(path.join(__dirname, 'assets')));
app.use(express.json());
dotenv.config({ path: 'env/user.env' }); // This will read the env/user.env file and set the environment variables
const { MongoClient } = require('mongodb');
const uri = `mongodb+srv://skyehigh:${process.env.MONGOPASS}@cluster.evnujdo.mongodb.net/`;
const client = new MongoClient(uri);
const bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({ extended: true }));
const accountSid = process.env.TWILIO_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const clientTwilio = require('twilio')(accountSid, authToken);

let access_token;
let refresh_token;
let user_id;

let participantsCollection;
let dataCollection;
let adminCollection;
let planCollection;
let usersCollection;
let weeklyPointsCollection;

async function connectToDatabase() {
    try {
        await client.connect();
        participantsCollection = client.db('Roybal').collection('participants');
        dataCollection = client.db('Roybal').collection('data');
        adminCollection = client.db('Roybal').collection('admin');
        planCollection = client.db('Roybal').collection('plan');
        usersCollection = client.db('Roybal').collection('users');
        weeklyPointsCollection = client.db('Roybal').collection('weeklyPoints');
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        throw error;
    }
}

// Call the connectToDatabase function
connectToDatabase();

const store = new MongoDBStore({
    uri: uri + 'Roybal',
    collection: 'sessions' // Name of the collection to store sessions
});

store.on('error', (error) => {
    console.error('Session store error:', error);
});

app.use(session({
    secret: process.env.SESSION_SECRET, // Replace with your session secret
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    },
    store: store
}));

app.use((req, res, next) => {
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '-1');
    next();
});

//signout route
app.get('/logout', (req, res) => {
    res.redirect('/login');
    req.session.destroy();
});

// Define the login route
app.get('/login', (req, res) => {
    // Check if the user is already logged in
    if (req.session?.user) {
        if (req.session.user === 'cnelab') {
            res.redirect('/admin');
        }
        else {
            res.redirect('/user_portal');
        }
    }
    else {
        res.sendFile(path.join(__dirname, 'assets/pages/login.html'));
    }
});

app.post('/login', async (req, res) => {
    const username = req.body.username;
    const password = req.body.password;

    try {
        const admin = await adminCollection.findOne({ user: username, pass: password });
        const user = await usersCollection.findOne({ user: username, pass: password });

        if (admin) {
            req.session.user = username;
            req.session.isAdmin = true; // Set isAdmin property for admins
            res.redirect('/admin');
        } else if (user) {
            req.session.user = username;
            req.session.isAdmin = false; // Set isAdmin property for regular users
            res.redirect('/user_portal'); // Redirect to the user portal
        }
        else {
            res.status(401).json({ success: false, error: 'Invalid username or password' });
        }
    } catch (error) {
        res.status(500).send('Internal Server Error');
    }
});

function requireAuth(req, res, next) {
    if (req.session?.user && req.session?.isAdmin) {
        return next(); // Regular user is authenticated, proceed to the next middleware or route handler
    } else {
        return res.redirect('/login'); // User is not authenticated, redirect to login page
    }
}

function requireUserAuth(req, res, next) {
    if (req.session?.user && !req.session?.isAdmin) {
        return next(); // Regular user is authenticated, proceed to the next middleware or route handler
    } else {
        return res.redirect('/login'); // User is not authenticated or is an admin, redirect to login page
    }
}


app.get('/user_portal', requireUserAuth, (req, res) => {
    const user_id = req.session.user; // Use the user ID from the session


    participantsCollection.findOne({ user_id })
        .then(user => {
            if (user) {
                res.sendFile(path.join(__dirname, 'assets/pages/user_portal.html'));
            } else {
                res.status(404).sendFile(path.join(__dirname, '404.html'));
            }
        })
        .catch(error => {
            console.error('Error fetching user:', error);
            res.status(500).sendFile(path.join(__dirname, '500.html'));
        });
});

// Serve the index page
app.get('/admin', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

//If the user is not logged in, redirect to the login page
app.get('/', (req, res) => {
    if (req.session?.user) {
        if (req.session.user === 'cnelab') {
            res.redirect('/admin');
        }
        else {
            res.redirect('/user_portal');
        }
    }
    else {
        res.redirect('/login');
    }
});

async function storeDataInDatabase(user_id, fitbitData) {
    try {
        const yesterday = new Date(new Date().setDate(new Date().getDate() - 1)).toISOString().slice(0, 10);
        const existingDocument = await dataCollection.findOne({ user_id, date: yesterday });

        if (existingDocument) {
            console.log(`Data for user ${user_id} on ${yesterday} already exists.`);
            return; // Data already exists, no need to store it again
        }

        // Assign the Fitbit data directly to the corresponding fields in the document
        const document = {
            user_id: user_id,
            date: yesterday,
            activities: fitbitData.activities,
            goals: fitbitData.goals,
            summary: fitbitData.summary
        };

        await dataCollection.insertOne(document);
        console.log(`Data stored in the database for user ${user_id} successfully.`);
    } catch (error) {
        console.error('Error storing data in database:', error);
        throw error; // Rethrow the error so it can be caught by the caller
    }
}

// Add a new route to refresh the access token
app.post('/admin/api/refresh-token/:user_id', async (req, res) => {
    console.log('Reached the refresh_token route'); // Add this line

    const user_id = req.params.user_id;

    try {
        const user = await participantsCollection.findOne({ user_id });

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const response = await fetch('https://api.fitbit.com/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString('base64')
            },
            body: `grant_type=refresh_token&refresh_token=${user.refresh_token}`
        });

        const data = await response.json();

        if (data.access_token) {
            const newAccessToken = data.access_token;
            const newRefreshToken = data.refresh_token || user.refresh_token;

            const result = await participantsCollection.updateOne(
                { user_id: user_id },
                { $set: { access_token: newAccessToken, refresh_token: newRefreshToken } }
            );

            if (result.modifiedCount > 0) {
                console.log(`Updated access token and refresh token for user ${user_id}`);
            } else {
                console.log(`User ${user_id} not found or access token/refresh token not updated`);
            }

            res.json({ newAccessToken, newRefreshToken });
        } else {
            console.log("block 1!")
            console.error('Error refreshing access token:', data.error);
            res.status(500).json({ error: 'Internal server error' });
        }
    } catch (error) {
        console.log("block 2!")
        console.error('Error refreshing access token:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add a new route to fetch all participants
app.get('/admin/api/participants', async (req, res) => {
    try {
        const participants = await participantsCollection.find().sort({ number: 1 }).toArray();
        const formattedParticipants = participants.map(({ user_id, number }, index) => ({
            user_id,
            number,
            name: `Participant ${index}`
        }));
        res.json({ success: true, data: formattedParticipants });
    } catch (error) {
        console.error('Error fetching participants:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Add a new route for the authorization callback
app.get('/auth/callback', async (req, res) => {
    res.sendFile(path.join(__dirname, 'assets/pages/login.html'));
    res.redirect('/');

    const authorizationCode = req.query.code; // Extract the authorization code from the URL

    // Use the authorization code to obtain access token
    const response = await fetch('https://api.fitbit.com/oauth2/token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `client_id=${process.env.CLIENT_ID}&grant_type=authorization_code&redirect_uri=${process.env.REDIRECT_URI}&code=${authorizationCode}&code_verifier=${process.env.PKCE_CODE_VERIFIER}`
    });

    const data = await response.json();
    access_token = data.access_token;
    refresh_token = data.refresh_token;
    user_id = data.user_id;
    const participantNumber = participantsCollection.countDocuments() + 1;

    try {
        const result = await participantsCollection.updateOne(
            { user_id: user_id },
            {
                $set: {
                    authorization_code: authorizationCode,
                    access_token: access_token,
                    refresh_token: refresh_token,
                    number: participantNumber
                }
            },
            { upsert: true } // Update existing record or insert new if not found
        );

        if (result.modifiedCount > 0) {
            console.log(`Updated record for user ${user_id}`);
        } else if (result.upsertedCount > 0) {
            console.log(`Inserted new record for user ${user_id}`);
        }

        //add a new document to the users collection
        await usersCollection.insertOne({
            user: user_id,
            pass: "cnelab"
        });

    } catch (error) {
        console.error('Error updating database:', error);
        throw error;
    }
});


// Add a new route to fetch all user IDs
app.get('/admin/api/user_ids', async (req, res) => {
    try {
        const userIDs = await participantsCollection.distinct('user_id');
        res.json({ userIDs });
    } catch (error) {
        console.error('Error fetching user IDs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


app.get('/admin/api/tokens/:user_id', (req, res) => {
    const user_id = req.params.user_id;

    // Fetch tokens for the specified user_id from the database
    // Return them as JSON
    participantsCollection.findOne({ user_id })
        .then(user => {
            if (user) {
                res.json({
                    access_token: user.access_token,
                    refresh_token: user.refresh_token,
                });
            } else {
                res.status(404).json({ error: 'User not found' });
            }
        })
        .catch(error => {
            console.error('Error fetching tokens:', error);
            res.status(500).json({ error: 'Internal server error' });
        });
});

// Add a new route for collecting Fitbit data
app.post('/admin/api/collect_data/:user_id', async (req, res) => {
    const user_id = req.params.user_id;
    const access_token = req.headers.authorization.split(' ')[1]; // Extract the access token from the Authorization header

    try {
        // Perform Fitbit API call with the obtained access token
        const yesterday = new Date(new Date().setDate(new Date().getDate() - 1)).toISOString().slice(0, 10);
        const fitbitDataResponse = await fetch(`https://api.fitbit.com/1/user/${user_id}/activities/date/${yesterday}.json`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${access_token}`
            }
        });

        if (fitbitDataResponse.ok) {
            const fitbitData = await fitbitDataResponse.json();


            // Assuming you have a function to store the data in your database
            // You can reuse the logic from your button click handler
            await storeDataInDatabase(user_id, fitbitData);
            console.log(`Data stored in the database for user ${user_id} successfully.`);

            res.json({ success: true, message: 'Data collected and stored successfully.' });
        } else {
            console.error(`HTTP error! status: ${fitbitDataResponse.status}`);
            res.status(401).json({ success: false, error: 'Error collecting data' });
        }
    } catch (error) {
        console.error(`Error fetching data for user ${user_id}:`, error);
        res.status(401).json({ success: false, error: 'Internal server error' });
    }
});

// Add a new route to fetch combined Fitbit data for a user
app.get('/admin/api/combined_data/:user_id', async (req, res) => {
    const user_id = req.params.user_id;

    try {
        const userDocuments = await dataCollection.find({ user_id }).toArray();

        if (userDocuments.length === 0) {
            console.error(`No data found for user ${user_id}`);
            res.status(404).json({ error: `No data found for user ${user_id}` });
            return;
        }

        let combinedData = [];
        for (const document of userDocuments) {
            combinedData.push(document);
        }

        res.json({ success: true, data: combinedData });
    } catch (error) {
        console.error(`Error fetching combined data for user ${user_id}:`, error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.post('/admin/submit-plan', async (req, res) => {
    const { identifier, selectedDays } = req.body;

    if (identifier && selectedDays) {
        try {
            const updated = await planCollection.updateOne(
                { identifier },
                {
                    $set: {
                        selectedDays,
                    }
                }
            );

            if (updated.modifiedCount > 0) {
                res.json({ success: true, message: 'Plan submitted successfully' });
            } else {
                res.json({ success: false, message: 'No matching contact found' });
            }
        } catch (error) {
            console.error('Error updating plan:', error);
            res.status(500).json({ success: false, error: 'Internal Server Error' });
        }
    } else {
        res.status(400).json({ success: false, error: 'Invalid request' });
    }
});

app.post('/admin/submit-contact', async (req, res) => {
    const { identifier, identifier_type, participantNumber } = req.body;

    if (identifier) {
        // Check if the contact already exists
        const existingContact = await planCollection.findOne({ identifier_type, identifier });
        if (existingContact) {
            res.json({ success: false, message: 'Contact already exists' });
            return;
        }
    }

    try {
        // Save the data with the desired structure,
        await planCollection.insertOne({
            identifier,
            identifier_type,
            participantNumber: parseInt(participantNumber),
            selectedDays: [],
            completedPlannedActivities: [],
            completedUnplannedActivities: [],
        });
        res.json({ success: true, message: 'Contact submitted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

app.get('/admin/get-contacts', async (req, res) => {
    try {
        const contacts = await planCollection.find().toArray();
        const identifiers = contacts.map(contact => contact.identifier);
        res.json({ success: true, data: identifiers });
    } catch (error) {
        console.error('Error fetching contacts:', error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});


// Define a new route handler
app.get('/admin/api/planned_activities/:user_id', async (req, res) => {
    const user_id = req.params.user_id;

    try {
        const user = await participantsCollection.findOne({ user_id });
        //if we find a user there, we can get the participantNumber
        const participantNumber = user.number;
        //now we can find the plan for that participant
        const plan = await planCollection.findOne({ participantNumber });
        //now we can get the selectedDays from the plan
        const selectedDays = plan.selectedDays;

        //obtain all the documents for the specified user_id
        const userDocuments = await dataCollection.find({ user_id }).toArray();

        //if there are no documents, return an empty array
        if (userDocuments.length === 0) {
            res.json({ success: true, plannedActivities: [], unplannedActivities: [] });
            return;
        }

        //from the documents, get each activity and add it to the combinedActivities array
        let combinedActivities = [];
        for (const document of userDocuments) {
            combinedActivities.push(...document.activities);
        }

        //filter the combinedActivities array to get only the activities that were planned
        const plannedActivities = combinedActivities.filter(activity => selectedDays.includes(activity.startDate.split('T')[0]));

        //filter the combinedActivities array to get only the activities that were unplanned
        const unplannedActivities = combinedActivities.filter(activity => !selectedDays.includes(activity.startDate.split('T')[0]));

        //check if the selectedDays array is empty
        if (selectedDays.length === 0) {
            res.json({ success: true, plannedActivities: [], unplannedActivities: [] });
            return;
        }

        res.json({ success: true, plannedActivities, unplannedActivities });
    } catch (error) {
        console.error('Error fetching planned activities:', error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});


app.post('/admin/api/points/:user_id', async (req, res) => {
    const user_id = req.params.user_id;
    const { plannedPoints, unplannedPoints } = req.body;

    try {
        const user = await participantsCollection.findOne({ user_id });
        //if we find a user there, we can get the participantNumber
        const participantNumber = user.number;

        // Mark the planned activity as completed in the plan collection by incrementing the planned_activities_count by 1
        const updated = await planCollection.updateOne(
            { participantNumber },
            { $inc: { planned_activities_count: plannedPoints, unplanned_activities_count: unplannedPoints } }
        );

        if (updated.modifiedCount > 0) {
            res.status(200).json({ success: true, message: 'Points updated successfully' });
        } else {
            res.status(300).json({ success: false, message: 'No matching planned activity found' });
        }
    } catch (error) {
        console.error('Error updating points:', error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

app.get('/api/get_user_data', requireUserAuth, async (req, res) => {
    const user_id = req.session.user;
    let points;

    const response = await axios.get(`http://roybal.vercel.app/admin/api/planned_activities/${user_id}`);
    const plannedAndUnplanned = await response.data;

    if (plannedAndUnplanned.success) {
        const plannedActivities = plannedAndUnplanned.plannedActivities;
        const unplannedActivities = plannedAndUnplanned.unplannedActivities;

        // Calculate points for planned activities (up to 5)
        // Only check for this week (Saturday to Sunday)
        const today = new Date();
        const saturday = new Date(today.setDate(today.getDate() - today.getDay()));
        const sunday = new Date(today.setDate(today.getDate() - today.getDay() + 6));

        const plannedActivitiesThisWeek = plannedActivities.filter(activity => {
            const activityDate = new Date(activity.startDate);
            return activityDate >= saturday && activityDate <= sunday;
        });
        const plannedPoints = Math.min(plannedActivitiesThisWeek.length, 5) * 400;

        // Calculate points for unplanned activities (up to 2)
        // Only check for this week (Saturday to Sunday)
        const unplannedActivitiesThisWeek = unplannedActivities.filter(activity => {
            const activityDate = new Date(activity.startDate);
            return activityDate >= saturday && activityDate <= sunday;
        });
        const unplannedPoints = Math.min(unplannedActivitiesThisWeek.length, 2) * 250;

        points = plannedPoints + unplannedPoints;

    }

    participantsCollection.findOne({ user_id })
        .then(async user => {
            if (user) {
                const plan = await planCollection.findOne({ participantNumber: user.number });

                const data = {
                    user_id: user.user_id,
                    number: user.number,
                    selectedDays: plan.selectedDays,
                    //get the dates of the completed planned activities
                    completedPlannedActivities: plan.completedPlannedActivities.map(activity => activity.startDate.split('T')[0]),
                    completedUnplannedActivities: plan.completedUnplannedActivities.map(activity => activity.startDate.split('T')[0]),
                    points: points
                };

                res.json(data);
            } else {
                res.status(404).json({ error: 'User not found' });
            }
        })
        .catch(error => {
            console.error('Error fetching user:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        });
});

app.get('/api/get_weekly_points', requireUserAuth, async (req, res) => {
    const user_id = req.session.user;

    try {
        const weeklyPoints = await weeklyPointsCollection.find({ user_id }).toArray();
        res.json({ success: true, data: weeklyPoints });
    } catch (error) {
        console.error('Error fetching weekly points:', error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// Serve the error page
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, '404.html'));
});

const axios = require('axios');

cron.schedule('49 15 * * *', async () => {
    console.log('Running scheduled task...');

    try {
        const response = await axios.get('http://roybal.vercel.app/admin/api/user_ids');
        const userIDs = response.data.userIDs;

        for (const user_id of userIDs) {
            try {
                const fitbitDataResponse = await collectFitbitData(user_id);

                if (fitbitDataResponse.status === 200) {
                    const fitbitData = fitbitDataResponse.data;
                    await storeDataInDatabase(user_id, fitbitData);
                    console.log(`Data stored in the database for user ${user_id} successfully.`);
                } else {
                    console.error(`HTTP error! status: ${fitbitDataResponse.status}`);
                }
            } catch (error) {
                console.error(`Error fetching data for user ${user_id}:`, error);
            }
        }

        const currentDate = new Date();
        const formattedDate = currentDate.toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format

        const plans = await planCollection.find({ selectedDays: formattedDate }).toArray();

        plans.forEach(async (plan) => {
            const identifier_type = plan.identifier_type;
            const identifier = plan.identifier;

            const body = `Hi,\n\nYou have a planned activity today! \n Best, \n Roybal`;

            identifier_type === 'email' ? await sendEmail(identifier, 'Planned Activity', body)
                : await sendSMS(identifier, body);
        });

        //verify completed activities, mark them as complete in the plan collection
        const users = await participantsCollection.find().toArray();

        users.forEach(async (user) => {
            const user_id = user.user_id;
            const participantNumber = user.number;
            const plan = await planCollection.findOne({ participantNumber });
            const selectedDays = plan.selectedDays;
            const userDocuments = await dataCollection.find({ user_id }).toArray();
            let combinedActivities = [];
            for (const document of userDocuments) {
                combinedActivities.push(...document.activities);
            }
            //if more than one activity is done on the same day, only the first one is marked as planned, the rest are unplanned
            //if an activity is done on a day that is not in the selectedDays array, it is unplanned
            const plannedActivities = combinedActivities.filter(activity => selectedDays.includes(activity.startDate.split('T')[0]));
            const unplannedActivities = combinedActivities.filter(activity => !selectedDays.includes(activity.startDate.split('T')[0]));

            await planCollection.updateOne(
                { participantNumber },
                {
                    $set: {
                        completedPlannedActivities: plannedActivities,
                        completedUnplannedActivities: unplannedActivities
                    }
                }
            );

            let points;

            const response = await axios.get(`http://roybal.vercel.app/admin/api/planned_activities/${user_id}`);
            const plannedAndUnplanned = await response.data;

            if (plannedAndUnplanned.success) {
                const plannedActivities = plannedAndUnplanned.plannedActivities;
                const unplannedActivities = plannedAndUnplanned.unplannedActivities;

                // Calculate points for planned activities (up to 5)
                // Only check for this week (Saturday to Sunday)
                const today = new Date();
                const saturday = new Date(today.setDate(today.getDate() - today.getDay()));
                const sunday = new Date(today.setDate(today.getDate() - today.getDay() + 6));

                const plannedActivitiesThisWeek = plannedActivities.filter(activity => {
                    const activityDate = new Date(activity.startDate);
                    return activityDate >= saturday && activityDate <= sunday;
                });
                const plannedPoints = Math.min(plannedActivitiesThisWeek.length, 5) * 400;

                // Calculate points for unplanned activities (up to 2)
                // Only check for this week (Saturday to Sunday)
                const unplannedActivitiesThisWeek = unplannedActivities.filter(activity => {
                    const activityDate = new Date(activity.startDate);
                    return activityDate >= saturday && activityDate <= sunday;
                });
                const unplannedPoints = Math.min(unplannedActivitiesThisWeek.length, 2) * 250;

                points = plannedPoints + unplannedPoints;

                participantsCollection.findOne({ user_id })
                    .then(async user => {
                        if (user) {
                            const plan = await planCollection.findOne({ participantNumber: user.number });

                            const data = {
                                user_id: user.user_id,
                                number: user.number,
                                selectedDays: plan.selectedDays,
                                //get the dates of the completed planned activities
                                completedPlannedActivities: plan.completedPlannedActivities.map(activity => activity.startDate.split('T')[0]),
                                completedUnplannedActivities: plan.completedUnplannedActivities.map(activity => activity.startDate.split('T')[0]),
                                points: points
                            };

                            //store the points in the weeklyPoints collection
                            console.log("points", points)
                            await storeWeeklypoints(user_id, points);

                        }
                    });
            }
        });
    } catch (error) {
        console.error('Error:', error);
    }
}, null, true, 'America/New_York');


// Function to collect Fitbit data
async function collectFitbitData(user_id) {
    try {
        const tokensResponse = await axios.get(`http://roybal.vercel.app/admin/api/tokens/${user_id}`);
        let { access_token, refresh_token, expires_in } = tokensResponse.data;

        const expirationTime = new Date(expires_in * 1000);

        if (Date.now() > expirationTime) {
            // Call your refresh token route
            const refreshResponse = await axios.post(`http://roybal.vercel.app/admin/api/refresh-token/${user_id}`, {
                refresh_token
            });

            // Update access token with the new one
            access_token = refreshResponse.data.access_token;
        }

        const yesterday = new Date(new Date().setDate(new Date().getDate() - 1)).toISOString().slice(0, 10);
        console.log(`Fetching data for user ${user_id} on ${yesterday}`);
        const fitbitDataResponse = await axios.get(`https://api.fitbit.com/1/user/${user_id}/activities/date/${yesterday}.json`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${access_token}`
            }
        });

        return fitbitDataResponse;
    } catch (error) {
        if (error.response.status === 401) {
            // Handle 401 error by refreshing the token
            try {
                // Call your refresh token route
                const refreshResponse = await axios.post(`http://roybal.vercel.app/admin/api/refresh-token/${user_id}`, {
                    refresh_token
                });

                if (refreshResponse.status === 200) {
                    // Update access token with the new one
                    access_token = refreshResponse.data.access_token;
                    // Retry Fitbit API call with the new access token
                    return await collectFitbitData(user_id);
                } else {
                    throw new Error(`HTTP error! status: ${refreshResponse.status}`);
                }
            } catch (refreshError) {
                throw new Error(`Error refreshing token for user ${user_id}: ${refreshError.message}`);
            }
        } else {
            throw error;
        }
    }
}


// Create a transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL, // Your email address
        pass: process.env.PASSWORD // Your password
    }
});

// Function to send an email
const sendEmail = async (to, subject, body) => {
    try {
        const info = await transporter.sendMail({
            from: process.env.EMAIL, // Sender's email address
            to, // Recipient's email address
            subject, // Email subject
            text: body // Plain text body
        });
        console.log('Email sent:', info.response);
    } catch (error) {
        console.log("No email sent")
    };
};

const sendSMS = async (to, body) => {
    console.log(to)
    try {
        const message = await clientTwilio.messages.create({
            body: body,
            from: process.env.TWILIO_NUMBER, // Twilio phone number
            to: to // Recipient's phone number
        });
        console.log('SMS sent:', message.sid);
    } catch (error) {
        console.log("No SMS sent", error)
    }
};

async function storeWeeklypoints(user_id, points) {
    //store the points in the weeklyPoints collection
    const currentDate = new Date();
    // if currentDate is within Saturday to Sunday, update the document for this week
    // otherwise, create a new document for the next week

    const saturday = new Date(currentDate.setDate(currentDate.getDate() - currentDate.getDay()));
    const sunday = new Date(currentDate.setDate(currentDate.getDate() - currentDate.getDay() + 6));

    const dateRange = {
        $gte: saturday.toISOString().split('T')[0],
        $lte: sunday.toISOString().split('T')[0]
    };

    const existingDocument = await weeklyPointsCollection.findOne({ user_id, date: dateRange });

    if (existingDocument) {
        //update the document
        await weeklyPointsCollection.updateOne(
            { user_id, date: dateRange },
            { $set: { points } }
        );
    }
    else {
        //create a new document
        await weeklyPointsCollection.insertOne({
            user_id,
            date: dateRange,
            points
        });
    }
}

const port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log('Press Ctrl+C to quit.');
});
