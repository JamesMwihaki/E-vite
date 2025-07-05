const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const cors = require('cors'); 
const app = express();
//const port = process.env.PORT || 3001;
//const { Pool } = require('pg')

const Gemini_api_key = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(Gemini_api_key);

// Enable CORS for all routes (important for development when frontend and backend are on different ports)
app.use(cors());
// Middleware to parse JSON bodies from incoming requests
// This is crucial for accepting data from your fetch POST request
app.use(express.json());

const create_events = require('../routes/events');
const db = require('/db/database');
const logger = require('./utils/logger');
const port = process.env.PORT || 3001;

async function startApp() {
    await db.connect_to_database(); // Connect to the database
    logger.info("connected to the databse");
    await create_events;
    console.log(`Server listening on port ${port}`);
}

startApp();

/*
const dbConfig = {
    user: process.env.DB_USER || 'James',
    host: process.env.DB_HOST || 'db', // 'db' is the service name from docker-compose.yml
    database: process.env.DB_NAME || 'grain_store',
    password: process.env.DB_PASSWORD || 'fullStack2025',
    port: process.env.DB_PORT || 5432,
};

const pool = new Pool(dbConfig)

pool.connect()
    .then(async client => {
        console.log("connected to the db");
        const create_message_board = 
        `
            CREATE TABLE IF NOT EXISTS messages(
                id SERIAL PRIMARY KEY,
                user_message TEXT,
                ai_response TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `

        //create a table if one doesn't exist
        const events_table = 
        `
            CREATE TABLE IF NOT EXISTS events_table(
                id SERIAL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                event_date DATE NOT NULL,
                event_time TIME,
                location TEXT,
                event_type TEXT,
                will_attend  BOOLEAN,  
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;

        try{
            await client.query(create_message_board);
            console.log("Message_Boards table created or already exists");
            await client.query(events_table);
            console.log("event_table table created or already exists");

            console.log("events created or arleady exists");
            client.release();
        }catch(err){
            console.error('Error creating the table', err.stack );
            client.release();
            process.exit(1);
        };        
    })
    .catch(err => {
        console.error('Database connection error:', err.stack);
        process.exit(1);
    });



// Define the POST endpoint that matches your fetch URL
app.post('/create-event', (req, res) => {
    const eventData = req.body; // The parsed JSON data will be available here
    console.log('Received event data:');
    console.log(eventData);
    res.status(200).json({
        message: 'Event successfully created!',
        receivedData: eventData // Optionally send back the received data for confirmation
    });
});



app.post('/api/create_events', async (req, res) => {
    const {title, description, date, time, location, type, willAttend } = req.body;
    console.log("Data Recieved in the backend but api/create_events");
    
    const queryText =
    `
        INSERT INTO events_table (title, description, event_date, event_time, location, event_type, will_attend)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id;
    `;

    const values = [title, description, date, time, location, type, willAttend];

    try{
        const insert_event_items = await pool.query(queryText, values);
        console.log("Items saved: ", insert_event_items.rows[0].id);

        res.status(201).json({
            message: 'Event successfully saved in the db',
            eventID: insert_event_items.rows[0].id
        });

    }catch (error){
        console.log("error inserting items into create table: ", error);
    }

});

app.get('/api/create_events', async (req, res) => {
    console.log("Request received at /api/create_events");
    const get_all_events  = `SELECT title, description, event_date, event_time, location, event_type, will_attend FROM events_table`;

    try{
        const result = await pool.query(get_all_events);
        //console.log("Events fetched successfully", result.rows.length, "events");
        res.json(result.rows);
    }catch (err) {
        console.error("error fetching the events", err.message);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});
*/


app.post('/api/events', async (req, res) => {
    const { eventName, eventLocation, eventTime, eventParticipants } = req.body; 
    console.log('Backend received req.body:', req.body);

    if (!eventName || !eventLocation || !eventTime) {
        return res.status(400).json({ message: 'Missing required event data (eventName, eventLocation, eventTimestamp).' });
    }
 
    const queryText =
    `
        INSERT INTO events (event_name, event_location, event_time, event_participants)
            VALUES ($1, $2, $3, $4)
            RETURNING id;
    `;


    const values = [eventName, eventLocation, eventTime, eventParticipants];
    try{
        const result = await pool.query(queryText, values);
        const newEvent = result.rows[0];

        console.log('Event saved in the db:', newEvent);

        res.status(201).json({
            message: 'Event successfully saved in the db',
            newEvent: newEvent,
        });

    }catch(error){
        console.error('error saving event to the db', error.stack);
        res.status(500).json({
            message: 'Failed to save to the db',
            error: error.message
        });
    }
});

app.post('/api/ai_input', async(req, res) => {
    const { ask_ai } = req.body;
    console.log("ask this to the ai", ask_ai);

    let aiResponse;

    try{
        const model = genAI.getGenerativeModel({model: "gemini-1s.5-flash" });
        const prompt = ask_ai;

        const result = await model.generateContent(prompt);
        const message = await result.response;
        aiResponse = message.text();


    }catch(error){
        console.error('Error generating ai response', error.stack);
        res.status(500).json({message:'Api failed', error: error.message});
    }

    try{
        const queryText =
        `
            INSERT INTO messages (user_message, ai_response)
                VALUES ($1, $2)
                RETURNING id;
        `;
        const data = [ask_ai, aiResponse];
        const dbResult = await pool.query(queryText, data);
        const newMessage = dbResult.rows[0];

        console.log('massages saved in the db:', newMessage);

        res.status(201).json({ 
            message: 'Success',
            aiResponse: aiResponse,
            messageId: newMessage.id
        });

        }catch(error){
            console.error('error saving event to the db', error.stack);
            res.status(200).json({
                message: 'Failed to save ai message to the db',
                error: error.message
            });
        }
});


app.get('/api/ai_output', async (req, res) => {
    console.log("Request received at /api/ai_input");
    const get_messages = `SELECT id user_message, ai_response FROM messages`;

    try{
        const result = await pool.query(get_messages);
        //console.log("Events fetched successfully", result.rows.length, "events");
        res.json(result.rows[result.rows.length - 1]);
    }catch (err) {
        console.error("error fetching the events", err.message);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});




// Start the server
app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});


// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server and closing database connection...');
    pool.end(() => {
        console.log('PostgreSQL client disconnected.');
        process.exit(0);
    });
});