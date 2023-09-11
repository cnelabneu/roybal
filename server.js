//server.js
const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const dotenv = require('dotenv');
dotenv.config({ path: 'env/user1.env' }); // This will read the env/user1.env file and set the environment variables

const app = express();

let access_token;
let refresh_token;

async function fetchInitialTokens() {
    const response = await fetch('https://api.fitbit.com/oauth2/token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `client_id=${process.env.CLIENT_ID}&grant_type=authorization_code&redirect_uri=https%3A%2F%2Froybal.vercel.app%2F&code=a638280fe30ef30fdf3d0c079bf75b821b634270&code_verifier=6g475k1l2t4e6y3m4g3i2i700v6e45536v0a0i5q2w6258003r0h0j6b473j2l171o4l4s2r2k0b11473i443h0k0d692u2y715n5h3l521t3z4c031k404v4q2a5v61`
    });

    const data = await response.json();
    access_token = data.access_token;
    refresh_token = data.refresh_token;

    process.env.ACCESS_TOKEN = access_token;
    process.env.REFRESH_TOKEN = refresh_token;

    console.log('Access Token:', process.env.ACCESS_TOKEN);
    console.log('Refresh Token:', process.env.REFRESH_TOKEN);
    console.log('Fitbit Response:', data);
}


// Call the function to fetch tokens
fetchInitialTokens();

// Serve static files from the 'assets' directory
const publicPath = '/assets'; // Set the correct public path
app.use(publicPath, express.static(path.join(__dirname, 'assets')));


app.get('/api/tokens', (req, res) => {
    res.json({
        access_token: process.env.ACCESS_TOKEN,
        refresh_token: process.env.REFRESH_TOKEN
    });
});

//Serve the index page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'), {
        access_token: process.env.ACCESS_TOKEN,
        refresh_token: process.env.REFRESH_TOKEN
    });
});

// Serve the error page
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, '404.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log('Press Ctrl+C to quit.');
});
