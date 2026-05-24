const express = require('express');
const crypto = require('crypto');
const logger = require('../utils/logger');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

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
        const eventCheck = await db.query('SELECT id FROM events WHERE id = $1', [event_id]);
        if (eventCheck.rows.length === 0) {
            return res.status(404).json({ message: `Event ${event_id} not found` });
        }

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
                created.push(result.rows[0]);
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

module.exports = router;
