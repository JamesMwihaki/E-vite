const express = require('express');
const logger = require('../utils/logger');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/;

// True when the given date+time is in the past. Times are stored without a
// timezone and NOW() is UTC, so the 12h grace keeps the check from rejecting
// datetimes that are still upcoming in the user's local timezone — the
// browser enforces the precise "from this moment forward" rule.
async function isPastDateTime(date, time) {
    const result = await db.query(
        `SELECT ($1::date + $2::time) < NOW() - INTERVAL '12 hours' AS passed`,
        [date, time]
    );
    return result.rows[0].passed;
}

router.post('/api/create_event', requireAuth, async (req, res) => {
    const { title, description, date, time, location, type, source_event_id } = req.body;
    const creatorId = req.session.user_id;
    logger.info(`POST /api/create_event by user=${creatorId}`);

    const queryText = `
        INSERT INTO events (title, description, event_date, event_time, location, event_type, creator_id, source_event_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id;
    `;

    if (!title || !date || !time) {
        return res.status(400).json({ message: 'title, date and time are required' });
    }
    if (!DATE_REGEX.test(date) || !TIME_REGEX.test(time)) {
        return res.status(400).json({ message: 'date must be YYYY-MM-DD and time must be HH:MM' });
    }

    try {
        if (await isPastDateTime(date, time)) {
            return res.status(400).json({ message: 'Event date and time must be in the future' });
        }

        // Forks must point at a real public event; anything else is dropped
        // with a 400 rather than silently creating a dangling reference.
        let sourceId = null;
        if (source_event_id != null) {
            sourceId = Number(source_event_id);
            if (!Number.isInteger(sourceId)) {
                return res.status(400).json({ message: 'source_event_id must be an integer' });
            }
            const source = await db.query(
                `SELECT event_type,
                        (event_date + event_time) < NOW() - INTERVAL '12 hours' AS passed
                 FROM events WHERE id = $1`,
                [sourceId]
            );
            if (source.rows.length === 0 || source.rows[0].event_type !== 'public') {
                return res.status(400).json({ message: 'source_event_id must reference an existing public event' });
            }
            if (source.rows[0].passed) {
                return res.status(400).json({ message: 'Cannot create an e-vite from a passed event' });
            }
        }

        const values = [title, description, date, time, location, type, creatorId, sourceId];
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
    //   - public events are visible to everyone, except agent-discovered ones,
    //     which show within 60 miles of the viewer's coordinates (haversine);
    //     exact city match is the fallback when either side lacks coordinates
    //     (no location set = no discovered events)
    //   - private events are visible only to the creator, to a directly-invited
    //     user (invitee_user_id), or to a user whose email matches an invitation
    const queryText = `
        SELECT e.id, e.title, e.description, e.event_date, e.event_time,
               e.location, e.event_type, e.creator_id, e.discovered, e.source_url
        FROM events e
        WHERE (e.event_type = 'public'
               AND (e.discovered = FALSE
                    OR EXISTS (
                        SELECT 1 FROM users me
                        WHERE me.id = $1
                          AND (
                              LOWER(COALESCE(e.city, '')) = LOWER(TRIM(COALESCE(me.location, '')))
                              OR (me.latitude IS NOT NULL AND e.latitude IS NOT NULL
                                  AND 3959 * acos(LEAST(1.0,
                                        cos(radians(me.latitude)) * cos(radians(e.latitude))
                                      * cos(radians(e.longitude) - radians(me.longitude))
                                      + sin(radians(me.latitude)) * sin(radians(e.latitude))
                                    )) <= 60)
                          )
                    )))
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

// Full detail for one event: the event itself, who's going (RSVPs), and the
// caller's own RSVP. The invitee list can contain raw emails, so it is only
// included for the creator. Visibility mirrors the list endpoint: public
// events for everyone; private events for the creator and invitees only.
router.get('/api/events/:id', requireAuth, async (req, res) => {
    const eventId = Number(req.params.id);
    const userId = req.session.user_id;
    if (!Number.isInteger(eventId)) {
        return res.status(400).json({ message: 'Invalid event id' });
    }

    try {
        const eventResult = await db.query(
            `SELECT e.id, e.title, e.description, e.event_date, e.event_time,
                    e.location, e.event_type, e.creator_id, e.created_at,
                    e.source_event_id, e.discovered, e.source_url,
                    s.title AS source_title,
                    u.username AS creator_username,
                    u.first_name AS creator_first_name,
                    u.last_name AS creator_last_name
             FROM events e
             JOIN users u ON u.id = e.creator_id
             LEFT JOIN events s ON s.id = e.source_event_id
             WHERE e.id = $1`,
            [eventId]
        );
        if (eventResult.rows.length === 0) {
            return res.status(404).json({ message: 'Event not found' });
        }
        const event = eventResult.rows[0];

        const isCreator = event.creator_id === userId;
        if (!isCreator && event.event_type !== 'public') {
            const invited = await db.query(
                `SELECT 1 FROM invitations
                 WHERE event_id = $1
                   AND (invitee_user_id = $2
                        OR invitee_email = (SELECT email FROM users WHERE id = $2))`,
                [eventId, userId]
            );
            if (invited.rows.length === 0) {
                return res.status(403).json({ message: 'You are not invited to this event' });
            }
        }

        const [attendees, myRsvp] = await Promise.all([
            db.query(
                `SELECT r.user_id, r.status, u.username, u.first_name, u.last_name
                 FROM rsvps r
                 JOIN users u ON u.id = r.user_id
                 WHERE r.event_id = $1
                 ORDER BY r.created_at ASC`,
                [eventId]
            ),
            db.query(
                'SELECT status FROM rsvps WHERE event_id = $1 AND user_id = $2',
                [eventId, userId]
            ),
        ]);

        let invitations = [];
        if (isCreator) {
            const invResult = await db.query(
                `SELECT i.id, i.invitee_email, i.invitee_user_id, i.status,
                        u.username AS invitee_username,
                        u.first_name AS invitee_first_name,
                        u.last_name AS invitee_last_name
                 FROM invitations i
                 LEFT JOIN users u ON u.id = i.invitee_user_id
                 WHERE i.event_id = $1
                 ORDER BY i.created_at ASC`,
                [eventId]
            );
            invitations = invResult.rows;
        }

        res.json({
            event,
            is_creator: isCreator,
            my_rsvp: myRsvp.rows[0]?.status || null,
            attendees: attendees.rows,
            invitations,
        });
    } catch (error) {
        logger.error(`Fetch event ${eventId} failed: ${error.message}`);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

router.put('/api/events/:id', requireAuth, async (req, res) => {
    const eventId = Number(req.params.id);
    const userId = req.session.user_id;
    if (!Number.isInteger(eventId)) {
        return res.status(400).json({ message: 'Invalid event id' });
    }
    const { title, description, date, time, location } = req.body;
    if (!title || !date || !time) {
        return res.status(400).json({ message: 'title, date and time are required' });
    }
    if (!DATE_REGEX.test(date) || !TIME_REGEX.test(time)) {
        return res.status(400).json({ message: 'date must be YYYY-MM-DD and time must be HH:MM' });
    }

    try {
        // Rescheduling must land in the future; an unchanged (possibly past)
        // date/time stays valid so old events can still get typo fixes.
        const existing = await db.query(
            `SELECT to_char(event_date, 'YYYY-MM-DD') AS date,
                    to_char(event_time, 'HH24:MI') AS time
             FROM events WHERE id = $1`,
            [eventId]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ message: 'Event not found' });
        }
        const dateTimeChanged =
            existing.rows[0].date !== date || existing.rows[0].time !== time.slice(0, 5);
        if (dateTimeChanged && await isPastDateTime(date, time)) {
            return res.status(400).json({ message: 'Event date and time must be in the future' });
        }

        const result = await db.query(
            `UPDATE events
             SET title = $1, description = $2, event_date = $3, event_time = $4, location = $5
             WHERE id = $6 AND creator_id = $7
             RETURNING id`,
            [title, description, date, time, location, eventId, userId]
        );
        if (result.rows.length === 0) {
            const exists = await db.query('SELECT 1 FROM events WHERE id = $1', [eventId]);
            return exists.rows.length > 0
                ? res.status(403).json({ message: 'Only the creator can edit this event' })
                : res.status(404).json({ message: 'Event not found' });
        }
        logger.info(`Event ${eventId} updated by user=${userId}`);
        res.json({ message: 'Event updated' });
    } catch (error) {
        logger.error(`Update event ${eventId} failed: ${error.message}`);
        res.status(500).json({ message: 'Update failed', error: error.message });
    }
});

// RSVPs and invitations are removed automatically via ON DELETE CASCADE.
router.delete('/api/events/:id', requireAuth, async (req, res) => {
    const eventId = Number(req.params.id);
    const userId = req.session.user_id;
    if (!Number.isInteger(eventId)) {
        return res.status(400).json({ message: 'Invalid event id' });
    }

    try {
        const result = await db.query(
            'DELETE FROM events WHERE id = $1 AND creator_id = $2 RETURNING id',
            [eventId, userId]
        );
        if (result.rows.length === 0) {
            const exists = await db.query('SELECT 1 FROM events WHERE id = $1', [eventId]);
            return exists.rows.length > 0
                ? res.status(403).json({ message: 'Only the creator can delete this event' })
                : res.status(404).json({ message: 'Event not found' });
        }
        logger.info(`Event ${eventId} deleted by user=${userId}`);
        res.json({ message: 'Event deleted' });
    } catch (error) {
        logger.error(`Delete event ${eventId} failed: ${error.message}`);
        res.status(500).json({ message: 'Delete failed', error: error.message });
    }
});

module.exports = router;
