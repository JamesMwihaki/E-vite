const express = require('express');
const logger = require('../utils/logger');
const app = express();
const { pool } = require('../db/database');
const cors = require('cors');

app.use(cors());
app.use(express.json());

logger.info("Welcome to the rsvp backend")

app.post('/api/rsvp', async (req,res) => {
    const { userId, eventId, status} = req.body;

    if (!eventId || !userId || !status) {
        logger.warn("RSVP request missing required fields:", req.body);
        return res.status(400).json({ message: 'Missing required fields: eventId, userId, status' });
    }
    logger.info("Data recieved in RSVP: ", req.body);

    const queryText = 
    `
     INSERT INTO rsvps (event_id, user_id, status)
     VALUES ($1, $2, $3)
     ON CONFLICT(user_id, event_id)
     DO UPDATE SET status = EXCLUDED.status, updated_at = now()
     RETURNING id, status;
    `
    const values = [eventId, userId, status];

    try{
        const upsert_rsvp_result = await pool.query(queryText, values);
        const newRsvp = upsert_rsvp_result.rows[0];

        logger.info(`RSVP saved/updated. ID: ${newRsvp.id}, Status: ${newRsvp.status}`);

        res.status(201).json({
            message: 'RSVP successfully saved',
            rsvp: newRsvp
        });
    }catch (error){
        logger.info("There was an error inserting items into the rsvp table", error)
        
        res.status(500).json({
            message: 'An error occurred while processing your RSVP.'
        });
    }
});