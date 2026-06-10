const express = require('express');
const logger = require('../utils/logger');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const VALID_STATUSES = ['going', 'not_going'];

router.post('/api/rsvp', requireAuth, async (req, res) => {
    const { event_id, status } = req.body;
    const userId = req.session.user_id;

    if (!event_id || !VALID_STATUSES.includes(status)) {
        return res.status(400).json({
            message: `event_id and status (one of: ${VALID_STATUSES.join(', ')}) are required`,
        });
    }

    try {
        // Event times are stored without a timezone and NOW() is UTC, so a
        // strict comparison could reject RSVPs hours before the event is over
        // in the user's local time. The 12h grace errs on the lenient side;
        // the UI hides RSVP buttons at the precise local time anyway.
        const eventCheck = await db.query(
            `SELECT (event_date + event_time) < NOW() - INTERVAL '12 hours' AS passed
             FROM events WHERE id = $1`,
            [event_id]
        );
        if (eventCheck.rows.length === 0) {
            return res.status(404).json({ message: 'Event not found' });
        }
        if (eventCheck.rows[0].passed) {
            return res.status(400).json({ message: 'This event has passed — RSVPs are closed' });
        }

        const queryText = `
            INSERT INTO rsvps (event_id, user_id, status)
            VALUES ($1, $2, $3)
            ON CONFLICT (event_id, user_id) DO UPDATE SET status = EXCLUDED.status
            RETURNING id, status;
        `;
        const result = await db.query(queryText, [event_id, userId, status]);
        logger.info(`RSVP upsert for event=${event_id} user=${userId} status=${status}`);
        res.status(201).json({ message: 'RSVP saved', rsvp: result.rows[0] });
    } catch (error) {
        logger.error(`RSVP save failed: ${error.message}`);
        res.status(500).json({ message: 'RSVP save failed', error: error.message });
    }
});

router.get('/api/rsvp', requireAuth, async (req, res) => {
    const { event_id } = req.query;
    const userId = req.session.user_id;

    if (!event_id) {
        return res.status(400).json({ message: 'event_id query param is required' });
    }

    try {
        const result = await db.query(
            'SELECT status FROM rsvps WHERE event_id = $1 AND user_id = $2',
            [event_id, userId]
        );
        res.json({ status: result.rows[0]?.status || null });
    } catch (error) {
        logger.error(`RSVP fetch failed: ${error.message}`);
        res.status(500).json({ message: 'RSVP fetch failed', error: error.message });
    }
});

router.get('/api/rsvps', requireAuth, async (req, res) => {
    const userId = req.session.user_id;
    try {
        const result = await db.query(
            'SELECT event_id, status FROM rsvps WHERE user_id = $1',
            [userId]
        );
        res.json(result.rows);
    } catch (error) {
        logger.error(`RSVPs fetch failed: ${error.message}`);
        res.status(500).json({ message: 'RSVPs fetch failed', error: error.message });
    }
});

module.exports = router;
