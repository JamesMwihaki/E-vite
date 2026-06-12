// Per-event group chat. Members are the event creator (the admin) and every
// invitee with an account (matched by invitee_user_id or by the email the
// invitation was sent to). Email invitees join the chat once they sign up
// with the invited address. The admin can delete any message; authors can
// delete their own. Realtime is polling — this runs on serverless.
const express = require('express');
const logger = require('../utils/logger');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const MAX_BODY_CHARS = 2000;

// Resolves whether the user may see/post in this event's chat.
async function membership(eventId, userId) {
    const result = await db.query(
        `SELECT e.creator_id = $2 AS is_creator,
                EXISTS (
                    SELECT 1 FROM invitations i
                    WHERE i.event_id = e.id
                      AND (i.invitee_user_id = $2
                           OR i.invitee_email = (SELECT email FROM users WHERE id = $2))
                ) AS invited
         FROM events e WHERE e.id = $1`,
        [eventId, userId]
    );
    if (result.rows.length === 0) return null; // event gone
    const row = result.rows[0];
    return { isCreator: row.is_creator, member: row.is_creator || row.invited };
}

router.get('/api/events/:id/messages', requireAuth, async (req, res) => {
    const eventId = Number(req.params.id);
    const after = Number(req.query.after) || 0;
    if (!Number.isInteger(eventId)) {
        return res.status(400).json({ message: 'Invalid event id' });
    }
    try {
        const mem = await membership(eventId, req.session.user_id);
        if (!mem) return res.status(404).json({ message: 'Event not found' });
        if (!mem.member) return res.status(403).json({ message: 'Chat is for the host and invitees' });

        const result = await db.query(
            `SELECT m.id, m.user_id, m.body, m.created_at,
                    u.username, u.first_name, u.last_name
             FROM event_messages m
             JOIN users u ON u.id = m.user_id
             WHERE m.event_id = $1 AND m.id > $2
             ORDER BY m.id ASC
             LIMIT 200`,
            [eventId, after]
        );
        res.json({ messages: result.rows, is_admin: mem.isCreator, me: req.session.user_id });
    } catch (error) {
        logger.error(`Chat fetch failed for event ${eventId}: ${error.message}`);
        res.status(500).json({ message: 'Could not load chat' });
    }
});

router.post('/api/events/:id/messages', requireAuth, async (req, res) => {
    const eventId = Number(req.params.id);
    const body = (req.body.body || '').trim();
    if (!Number.isInteger(eventId)) {
        return res.status(400).json({ message: 'Invalid event id' });
    }
    if (!body) return res.status(400).json({ message: 'Message cannot be empty' });
    if (body.length > MAX_BODY_CHARS) {
        return res.status(400).json({ message: `Message too long (max ${MAX_BODY_CHARS} characters)` });
    }
    try {
        const mem = await membership(eventId, req.session.user_id);
        if (!mem) return res.status(404).json({ message: 'Event not found' });
        if (!mem.member) return res.status(403).json({ message: 'Chat is for the host and invitees' });

        const result = await db.query(
            `INSERT INTO event_messages (event_id, user_id, body)
             VALUES ($1, $2, $3)
             RETURNING id, created_at`,
            [eventId, req.session.user_id, body]
        );
        res.status(201).json({ id: result.rows[0].id, created_at: result.rows[0].created_at });
    } catch (error) {
        logger.error(`Chat post failed for event ${eventId}: ${error.message}`);
        res.status(500).json({ message: 'Could not send message' });
    }
});

// Authors delete their own messages; the event creator (admin) can delete any.
router.delete('/api/events/:id/messages/:messageId', requireAuth, async (req, res) => {
    const eventId = Number(req.params.id);
    const messageId = Number(req.params.messageId);
    if (!Number.isInteger(eventId) || !Number.isInteger(messageId)) {
        return res.status(400).json({ message: 'Invalid id' });
    }
    try {
        const mem = await membership(eventId, req.session.user_id);
        if (!mem) return res.status(404).json({ message: 'Event not found' });

        const result = await db.query(
            `DELETE FROM event_messages
             WHERE id = $1 AND event_id = $2
               AND ($3::boolean OR user_id = $4)
             RETURNING id`,
            [messageId, eventId, mem.isCreator, req.session.user_id]
        );
        if (result.rows.length === 0) {
            return res.status(403).json({ message: 'Only the author or the host can delete a message' });
        }
        res.json({ message: 'Deleted' });
    } catch (error) {
        logger.error(`Chat delete failed for event ${eventId}: ${error.message}`);
        res.status(500).json({ message: 'Could not delete message' });
    }
});

module.exports = router;
