const express = require('express');
const logger = require('../utils/logger');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/api/users/search', requireAuth, async (req, res) => {
    const userId = req.session.user_id;
    const q = (req.query.q || '').trim();

    if (!q) {
        return res.json([]);
    }

    const queryText = `
        SELECT
            u.id,
            u.username,
            u.first_name,
            u.last_name,
            u.email,
            f.id AS friendship_id,
            f.status AS friendship_status,
            (f.requester_id = $1) AS i_am_requester
        FROM users u
        LEFT JOIN friendships f ON (
            (f.requester_id = $1 AND f.addressee_id = u.id)
            OR (f.addressee_id = $1 AND f.requester_id = u.id)
        )
        WHERE u.id <> $1
          AND (
              u.username   ILIKE $2
              OR u.email   ILIKE $2
              OR u.first_name ILIKE $2
              OR u.last_name  ILIKE $2
          )
        ORDER BY u.username ASC
        LIMIT 20;
    `;

    try {
        const result = await db.query(queryText, [userId, `%${q}%`]);
        res.json(result.rows);
    } catch (error) {
        logger.error(`User search failed: ${error.message}`);
        res.status(500).json({ message: 'Search failed', error: error.message });
    }
});

module.exports = router;
