const express = require('express');
const crypto = require('crypto');
const logger = require('../utils/logger');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { sendInvitationEmail } = require('../utils/mailer');

const router = express.Router();
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/api/invitations', requireAuth, async (req, res) => {
    const { event_id, emails = [], friend_ids = [] } = req.body;
    const inviterId = req.session.user_id;

    if (!event_id) {
        return res.status(400).json({ message: 'event_id is required' });
    }
    if (!Array.isArray(emails) || !Array.isArray(friend_ids)) {
        return res.status(400).json({ message: 'emails and friend_ids must be arrays' });
    }
    if (emails.length === 0 && friend_ids.length === 0) {
        return res.status(400).json({ message: 'Provide at least one email or friend_id' });
    }

    try {
        const eventCheck = await db.query(
            `SELECT e.id, e.title, e.description, to_char(e.event_date, 'YYYY-MM-DD') AS event_date,
                    e.event_time, e.location,
                    u.first_name, u.last_name, u.username
             FROM events e JOIN users u ON u.id = e.creator_id
             WHERE e.id = $1`,
            [event_id]
        );
        if (eventCheck.rows.length === 0) {
            return res.status(404).json({ message: `Event ${event_id} not found` });
        }
        const event = eventCheck.rows[0];
        const inviterName = [event.first_name, event.last_name].filter(Boolean).join(' ')
            || event.username;

        const created = [];
        const skipped = [];

        // Invite friends by user_id.
        for (const rawId of friend_ids) {
            const userId = Number(rawId);
            if (!Number.isInteger(userId)) {
                skipped.push({ friend_id: rawId, reason: 'invalid id' });
                continue;
            }
            if (userId === inviterId) {
                skipped.push({ friend_id: userId, reason: 'cannot invite yourself' });
                continue;
            }

            try {
                const dup = await db.query(
                    'SELECT id FROM invitations WHERE event_id = $1 AND invitee_user_id = $2',
                    [event_id, userId]
                );
                if (dup.rows.length > 0) {
                    skipped.push({ friend_id: userId, reason: 'already invited' });
                    continue;
                }
                const token = crypto.randomUUID();
                const result = await db.query(
                    `INSERT INTO invitations (event_id, inviter, invitee_user_id, status, token)
                     VALUES ($1, $2, $3, 'pending', $4)
                     RETURNING id, invitee_user_id, token, status;`,
                    [event_id, inviterId, userId, token]
                );
                created.push(result.rows[0]);
            } catch (error) {
                logger.error(`Insert friend invitation failed for user=${userId}: ${error.message}`);
                skipped.push({ friend_id: userId, reason: error.message });
            }
        }

        // Invite external addresses by email.
        for (const rawEmail of emails) {
            const email = (rawEmail || '').trim();
            if (!email) continue;
            if (!EMAIL_REGEX.test(email)) {
                skipped.push({ email, reason: 'invalid format' });
                continue;
            }

            try {
                const dup = await db.query(
                    'SELECT id FROM invitations WHERE event_id = $1 AND invitee_email = $2',
                    [event_id, email]
                );
                if (dup.rows.length > 0) {
                    skipped.push({ email, reason: 'already invited' });
                    continue;
                }
                const token = crypto.randomUUID();
                const result = await db.query(
                    `INSERT INTO invitations (event_id, inviter, invitee_email, status, token)
                     VALUES ($1, $2, $3, 'pending', $4)
                     RETURNING id, invitee_email, token, status;`,
                    [event_id, inviterId, email, token]
                );
                // Best-effort: a failed send still leaves a valid invitation
                // (the invitee sees it in-app if they sign up with this email).
                const emailed = await sendInvitationEmail({
                    to: email, inviterName, event, token,
                }).catch((err) => {
                    logger.error(`Invitation email to ${email} failed: ${err.message}`);
                    return false;
                });
                created.push({ ...result.rows[0], emailed });
            } catch (error) {
                logger.error(`Insert email invitation failed for ${email}: ${error.message}`);
                skipped.push({ email, reason: error.message });
            }
        }

        logger.info(`Created ${created.length} invitations for event ${event_id} (skipped ${skipped.length})`);
        res.status(201).json({ created, skipped });
    } catch (error) {
        logger.error(`Invitations endpoint failed: ${error.message}`);
        res.status(500).json({ message: 'Failed to create invitations', error: error.message });
    }
});

router.get('/api/invitations', requireAuth, async (req, res) => {
    const { event_id } = req.query;
    if (!event_id) {
        return res.status(400).json({ message: 'event_id query param is required' });
    }
    try {
        const result = await db.query(
            `SELECT i.id, i.invitee_email, i.invitee_user_id, i.status, i.token, i.created_at,
                    u.username AS invitee_username, u.first_name AS invitee_first_name, u.last_name AS invitee_last_name
             FROM invitations i
             LEFT JOIN users u ON u.id = i.invitee_user_id
             WHERE i.event_id = $1
             ORDER BY i.created_at ASC`,
            [event_id]
        );
        res.json(result.rows);
    } catch (error) {
        logger.error(`Invitations fetch failed: ${error.message}`);
        res.status(500).json({ message: 'Invitations fetch failed', error: error.message });
    }
});

/* ---- public RSVP-by-token (no login required) ---- */

const TOKEN_REGEX = /^[0-9a-f-]{36}$/i;

// The invitation email links here. Returns the invitation + event details so
// the invite page can render without an account.
router.get('/api/invite/:token', async (req, res) => {
    const { token } = req.params;
    if (!TOKEN_REGEX.test(token)) {
        return res.status(400).json({ message: 'Invalid invitation link' });
    }
    try {
        const result = await db.query(
            `SELECT i.status, i.invitee_email,
                    e.id AS event_id, e.title, e.description,
                    to_char(e.event_date, 'YYYY-MM-DD') AS event_date,
                    e.event_time, e.location,
                    u.first_name, u.last_name, u.username
             FROM invitations i
             JOIN events e ON e.id = i.event_id
             JOIN users u ON u.id = i.inviter
             WHERE i.token = $1`,
            [token]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Invitation not found' });
        }
        const row = result.rows[0];
        res.json({
            status: row.status,
            event: {
                title: row.title,
                description: row.description,
                event_date: row.event_date,
                event_time: row.event_time,
                location: row.location,
            },
            inviter: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.username,
        });
    } catch (error) {
        logger.error(`Invite lookup failed: ${error.message}`);
        res.status(500).json({ message: 'Could not load invitation' });
    }
});

router.post('/api/invite/:token/rsvp', async (req, res) => {
    const { token } = req.params;
    const { status } = req.body;
    if (!TOKEN_REGEX.test(token)) {
        return res.status(400).json({ message: 'Invalid invitation link' });
    }
    if (!['accepted', 'declined'].includes(status)) {
        return res.status(400).json({ message: "status must be 'accepted' or 'declined'" });
    }
    try {
        const result = await db.query(
            `UPDATE invitations SET status = $1 WHERE token = $2 RETURNING id`,
            [status, token]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Invitation not found' });
        }
        logger.info(`Invitation ${result.rows[0].id} ${status} via token link`);
        res.json({ message: `RSVP recorded: ${status}` });
    } catch (error) {
        logger.error(`Invite RSVP failed: ${error.message}`);
        res.status(500).json({ message: 'Could not save RSVP' });
    }
});

module.exports = router;
