const express = require('express');
const logger = require('../utils/logger');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/api/create_event', requireAuth, async (req, res) => {
    const { title, description, date, time, location, type } = req.body;
    const creatorId = req.session.user_id;
    logger.info(`POST /api/create_event by user=${creatorId}`);

    const queryText = `
        INSERT INTO events (title, description, event_date, event_time, location, event_type, creator_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id;
    `;
    const values = [title, description, date, time, location, type, creatorId];

    try {
        const result = await db.query(queryText, values);
        res.status(201).json({
            message: 'Event saved',
            eventID: result.rows[0].id,
        });
    } catch (error) {
        logger.error(`Insert into events failed: ${error.message}`);
        res.status(500).json({ message: 'Insert failed', error: error.message });
    }
});

router.get('/api/create_event', requireAuth, async (req, res) => {
    const userId = req.session.user_id;

    // Visibility:
    //   - public events are visible to everyone
    //   - private events are visible only to the creator, to a directly-invited
    //     user (invitee_user_id), or to a user whose email matches an invitation
    const queryText = `
        SELECT e.id, e.title, e.description, e.event_date, e.event_time,
               e.location, e.event_type, e.creator_id
        FROM events e
        WHERE e.event_type = 'public'
           OR e.creator_id = $1
           OR EXISTS (
               SELECT 1
               FROM invitations i
               WHERE i.event_id = e.id
                 AND (
                     i.invitee_user_id = $1
                     OR i.invitee_email = (SELECT email FROM users WHERE id = $1)
                 )
           )
        ORDER BY e.created_at DESC;
    `;

    try {
        const result = await db.query(queryText, [userId]);
        res.json(result.rows);
    } catch (error) {
        logger.error(`Fetch events failed: ${error.message}`);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

module.exports = router;
