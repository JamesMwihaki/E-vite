const express = require('express');
const logger = require('../utils/logger');
const app = express();
const { pool } = require('../db/database');
const cors = require('cors');

app.use(cors());
app.use(express.json());

const db = require('/db/database');
const port = process.env.PORT || 3001;
const currentUserId = 5; // Static current user ID

logger.info("Welcome to the events backend");
app.post('/api/create_event', async (req, res) => {
    const {title, description, date, time, location, type} = req.body;
    logger.info("Data Recieved in the backend but api/create_event");
    
    const queryText =
    `
        INSERT INTO events(title, description, event_date, event_time, location, event_type)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id;
    `;

    const values = [title, description, date, time, location, type];

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

app.get('/api/create_event', async (req, res) => {
    console.log("Request received at /api/create_events");
    const get_all_events  = 
    `
        SELECT
            e.id,
            e.title,
            e.description,
            e.event_date,
            e.event_time,
            e.location,
            e.event_type
        FROM events AS e
        JOIN invitations AS i
            ON e.id = i.event_id
        WHERE
            i.invitee = ${currentUserId}
        UNION
        SELECT
            id,
            title,
            description,
            event_date,
            event_time,
            location,
            event_type
        FROM events
        WHERE
            event_type = 'public';
        `;

    try{
        const result = await pool.query(get_all_events, "");
        //console.log("Events fetched successfully", result.rows.length, "events");
        res.json(result.rows);
    }catch (err) {
        console.error("error fetching the events", err.message);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});

app.post('/api/rsvp', async (req,res) => {
    logger.info("Welcome to the rsvp backend")
    const { userId, eventId, status} = req.body;
    logger.info("Status: ",status);
    if (!eventId || !userId || !status) {
        logger.warn("RSVP request missing required fields:", req.body);
        return res.status(400).json({ message: 'Missing required fields: eventId, userId, status' });
    }
    console.log("Data recieved in RSVP: ", userId, eventId, status);

    const queryText = 
    `
        INSERT INTO rsvps (event_id, user_id, status)
        VALUES ($1, $2, $3)
        ON CONFLICT(user_id, event_id)
        DO UPDATE SET 
            status = EXCLUDED.status, 
            updated_at = now()
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

app.get('/api/rsvp', async (req, res) => {
    console.log("Request received at get /api/rsvp");
    const get_all_rsvps  = `SELECT event_id, user_id, status FROM rsvps`;

    try{
        const result = await pool.query(get_all_rsvps, "");
        console.log("rsvps fetched successfully", result.rows.length, "events");
        res.json(result.rows);
    }catch (err) {
        console.error("error fetching the rsvps", err.message);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});

app.get('/api/load_network', async (req, res) => {
    console.log("Request received at /api/load_network");
    const get_users_network  = `SELECT id, first_name, last_name, username FROM users`;

    try{
        const result = await pool.query(get_users_network, "");
        //console.log("Events fetched successfully", result.rows.length, "events");
        res.json(result.rows);
    }catch (err) {
        console.error("error fetching the events", err.message);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});


app.post('/api/invitees', async (req, res) => {
    logger.info("Request recieved at invitees endpoint");
    console.log("invite data", req.body);
    try{
        const {event_id, inviter_id, selectedGuests} = req.body;
        console.log("invite data", event_id, " ", inviter_id);
        if(!event_id || !inviter_id || !selectedGuests || !Array.isArray(selectedGuests)){
            console.log("Missing critical data or error with selectedGuests");
            return res.status(400).json({
                message: 'Missing required fields: event_id, inviter_id, or selectedGuests'
            });
        }

        const createdInvitations = [];
        for(const guest of selectedGuests){
            if(!guest.id){
                console.log("Guest missing Id, skipping:", guest);
                console.log("problamatic guest id", event_id, inviter_id, guest.id);
                continue;
            }
            console.log("individual guest id", event_id, inviter_id, guest.id);

            const queryText = 
            `
                INSERT INTO invitations (event_id,inviter, invitee)
                VALUES ($1, $2, $3)
                RETURNING id;
            `

            try{
                const result = await pool.query(queryText, [event_id, inviter_id, guest.id]);
                const invitationId = result.rows[0].id;

                console.log("invitation id: ", invitationId);

                createdInvitations.push({
                    id: invitationId,
                    guest_id: guest.id,
                });
                
            }catch (error){
                console.log("Error inserting invitation for guest: ", guest.id, error);
            }   
        }  
        if(createdInvitations.length > 0){
            res.status(201).json({
                message: `Successfully create ${createdInvitations} invitations`,
                invitations: createdInvitations,
                total_precessed: selectedGuests.length


            });
        }else {
            res.status(400).json({
                message: 'No invitations created',
                total_precessed: selectedGuests.length,
            })
        }
        
    }catch (error){
        console.log("Error proccesing invitations", error);
        res.status(500).json({
            message: 'An error occurred while processing the invitation.'
        });
    }
});

app.get('/api/invitees', async (req, res) => {
    logger.info("welcom to the invitees get");
    const event_guest = `SELECT id, event_id, inviter, invitee, status FROM invitations`

    try{
        const result = await pool.query(event_guest, "");
        console.log("guest fetched successfully: ", result.rows.length, "guests");
        res.json(result.rows);
    }catch (err) {
        console.error("error fetching the guests", err.message);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
})


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`);
});
