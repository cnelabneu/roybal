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

async function connectToDatabase() {
    try {
        await client.connect();
        participantsCollection = client.db('Roybal').collection('participants');
        dataCollection = client.db('Roybal').collection('data');
        adminCollection = client.db('Roybal').collection('admin');
        planCollection = client.db('Roybal').collection('plan');
        usersCollection = client.db('Roybal').collection('users');
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

// Add session middleware
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: true,
    saveUninitialized: true
}));

app.use((req, res, next) => {
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '-1');
    next();
});


// Middleware to check if user is authenticated
function requireAuth(req, res, next) {
    console.log(req.session?.user)
    if (req.session?.user) {
        return next(); // User is authenticated, proceed to the next middleware or route handler
    } else {
        return res.redirect('/login'); // User is not authenticated, redirect to login page
    }
}

// Define the login route
app.get('/login', (req, res) => {
    // Check if the user is already logged in
    if (req.session?.user) {
        return res.redirect('/'); // Redirect to the home page if already logged in
    }
    else {
        res.sendFile(path.join(__dirname, 'assets/pages/login.html'));
    }
});

// Handle login form submission
app.post('/login', async (req, res) => {
    const username = req.body.username;
    const password = req.body.password;

    try {
        const admin = await adminCollection.findOne({ user: username, pass: password });
        const user = await usersCollection.findOne({ user: username, pass: password });

        if (admin) {
            req.session.user = username;
            console.log('User authenticated successfully')
            res.redirect('/');
        }
        else if (user) {
            //TODO: set up user portal
            req.session.user = username;
            console.log('User authenticated successfully')
            res.redirect('/login');
        }
        else {
            console.log('Invalid username or password')
            res.status(401).json({ success: false, error: 'Invalid username or password' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

//Serve the index page
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
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
app.post('/api/refresh-token/:user_id', async (req, res) => {
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

    try {
        const result = await participantsCollection.updateOne(
            { user_id: user_id },
            {
                $set: {
                    authorization_code: authorizationCode,
                    access_token: access_token,
                    refresh_token: refresh_token
                }
            },
            { upsert: true } // Update existing record or insert new if not found
        );

        if (result.modifiedCount > 0) {
            console.log(`Updated record for user ${user_id}`);
        } else if (result.upsertedCount > 0) {
            console.log(`Inserted new record for user ${user_id}`);
        }

    } catch (error) {
        console.error('Error updating database:', error);
        throw error;
    }
});


// Add a new route to fetch all user IDs
app.get('/api/user_ids', async (req, res) => {
    try {
        const userIDs = await participantsCollection.distinct('user_id');
        res.json({ userIDs });
    } catch (error) {
        console.error('Error fetching user IDs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


app.get('/api/tokens/:user_id', (req, res) => {
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
app.post('/api/collect_data/:user_id', async (req, res) => {
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
app.get('/api/combined_data/:user_id', async (req, res) => {
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


app.post('/submit-plan', async (req, res) => {
    const { contact, selectedDays, plannedActivities } = req.body;

    if (contact && (selectedDays || plannedActivities)) {
        try {
            const updated = await planCollection.updateOne(
                { $or: [{ email: contact }, { phone: contact }] },
                {
                    $addToSet: { selectedDays: { $each: selectedDays } },
                    $addToSet: { plannedActivities: { $each: plannedActivities } }
                }
            );

            if (updated.modifiedCount > 0) {
                res.json({ success: true, message: 'Plan submitted successfully' });
            } else {
                res.json({ success: false, message: 'No matching email or phone found' });
            }
        } catch (error) {
            console.error('Error updating plan:', error);
            res.status(500).json({ success: false, error: 'Internal Server Error' });
        }
    } else {
        res.status(400).json({ success: false, error: 'Invalid request' });
    }
});

// Define a new route handler
app.get('/api/planned_activities/:user_id', async (req, res) => {
    const user_id = req.params.user_id;

    try {
        const user = await planCollection.findOne({ email: user_id }); // Assuming 'email' is the unique identifier for users
        if (!user) {
            return res.json({ success: false, error: 'User not found' });
        }

        res.json({ success: true, data: user.plannedActivities });
    } catch (error) {
        console.error('Error fetching planned activities:', error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

app.post('/submit-contact', async (req, res) => {
    const { email, phone } = req.body;

    if (email) {
        // Check if the email already exists in the database
        const existingEmail = await planCollection.findOne({ email });
        if (existingEmail) {
            return res.json({ success: false, message: 'Email address already exists' });
        }
    }

    if (phone) {
        // Check if the phone number already exists in the database
        const existingPhone = await planCollection.findOne({ phone });
        if (existingPhone) {
            return res.json({ success: false, message: 'Phone number already exists' });
        }
    }

    try {
        await planCollection.insertOne({ email, phone, selectedDays: [] });
        res.json({ success: true, message: 'Contact submitted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

app.get('/get-contacts', async (req, res) => {
    try {
        const emails = await planCollection.distinct('email');
        const phones = await planCollection.distinct('phone');
        const combinedData = [...emails, ...phones];
        res.json({ success: true, data: combinedData });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// Serve the error page
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, '404.html'));
});

const axios = require('axios');
const e = require('express');

cron.schedule('43 8 * * *', async () => {
    console.log('Running scheduled task...');

    try {
        const response = await axios.get('http://roybal.vercel.app/api/user_ids');
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
        const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][currentDate.getDay()];

        const plans = await planCollection.find({ selectedDays: dayOfWeek }).toArray();

        plans.forEach(async (plan) => {
            // const email = plan.email;
            // const subject = 'You planned to walk today';
            // const body = 'Don\'t forget to get your steps in today!';
            // await sendEmail(email, subject, body);

            // const phone = plan.phone; // Assuming the phone number is stored in 'phone' field
            // const smsBody = 'Don\'t forget to get your steps in today!';
            // await sendSMS(phone, smsBody);
        });
    } catch (error) {
        console.error('Error:', error);
    }
}, null, true, 'America/New_York');


// Function to collect Fitbit data
async function collectFitbitData(user_id) {
    try {
        const tokensResponse = await axios.get(`http://roybal.vercel.app/api/tokens/${user_id}`);
        let { access_token, refresh_token, expires_in } = tokensResponse.data;

        const expirationTime = new Date(expires_in * 1000);

        if (Date.now() > expirationTime) {
            // Call your refresh token route
            const refreshResponse = await axios.post(`http://roybal.vercel.app/api/refresh-token/${user_id}`, {
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
                const refreshResponse = await axios.post(`http://roybal.vercel.app/api/refresh-token/${user_id}`, {
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
        console.error('Error sending email:', error);
    }
};

const sendSMS = async (to, body) => {
    try {
        const message = await clientTwilio.messages.create({
            body: body,
            from: process.env.TWILIO_NUMBER, // Twilio phone number
            to: to // Recipient's phone number
        });
        console.log('SMS sent:', message.sid);
    } catch (error) {
        console.error('Error sending SMS:', error);
    }
};

const port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log('Press Ctrl+C to quit.');
});
