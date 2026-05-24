const express = require('express');
const logger = require('../utils/logger');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const PG_UNIQUE_VIOLATION = '23505';

// Accepted friends — the other person in each friendship row.
router.get('/api/friends', requireAuth, async (req, res) => {
    const me = req.session.user_id;
    const queryText = `
        SELECT
            u.id, u.username, u.first_name, u.last_name, u.email,
            f.id AS friendship_id, f.created_at
        FROM friendships f
        JOIN users u ON u.id = CASE
            WHEN f.requester_id = $1 THEN f.addressee_id
            ELSE f.requester_id
        END
        WHERE (f.requester_id = $1 OR f.addressee_id = $1)
          AND f.status = 'accepted'
        ORDER BY f.created_at DESC;
    `;
    try {
        const result = await db.query(queryText, [me]);
        res.json(result.rows);
    } catch (error) {
        logger.error(`Friends list failed: ${error.message}`);
        res.status(500).json({ message: 'Failed to load friends', error: error.message });
    }
});

// Incoming pending requests — people who want to friend me.
router.get('/api/friends/requests', requireAuth, async (req, res) => {
    const me = req.session.user_id;
    const queryText = `
        SELECT
            u.id, u.username, u.first_name, u.last_name, u.email,
            f.id AS friendship_id, f.created_at
        FROM friendships f
        JOIN users u ON u.id = f.requester_id
        WHERE f.addressee_id = $1 AND f.status = 'pending'
        ORDER BY f.created_at DESC;
    `;
    try {
        const result = await db.query(queryText, [me]);
        res.json(result.rows);
    } catch (error) {
        logger.error(`Friend requests fetch failed: ${error.message}`);
        res.status(500).json({ message: 'Failed to load requests', error: error.message });
    }
});

// Send a friend request. If they've already sent one to me, auto-accept.
router.post('/api/friends/request', requireAuth, async (req, res) => {
    const me = req.session.user_id;
    const { addressee_id } = req.body;

    if (!addressee_id || Number(addressee_id) === me) {
        return res.status(400).json({ message: 'Valid addressee_id (not yourself) is required' });
    }

    try {
        const existing = await db.query(
            `SELECT id, requester_id, addressee_id, status
             FROM friendships
             WHERE (requester_id = $1 AND addressee_id = $2)
                OR (requester_id = $2 AND addressee_id = $1)
             LIMIT 1`,
            [me, addressee_id]
        );

        if (existing.rows.length > 0) {
            const row = existing.rows[0];
            if (row.status === 'accepted') {
                return res.status(200).json({ message: 'Already friends', friendship: row });
            }
            // Pending. If THEY sent it (I'm the addressee), auto-accept.
            if (row.addressee_id === me) {
                await db.query(
                    "UPDATE friendships SET status = 'accepted', updated_at = NOW() WHERE id = $1",
                    [row.id]
                );
                logger.info(`Auto-accepted friendship ${row.id} (me=${me} other=${row.requester_id})`);
                return res.status(200).json({ message: 'Friend request accepted', friendship_id: row.id, status: 'accepted' });
            }
            return res.status(200).json({ message: 'Request already pending', friendship: row });
        }

        const insert = await db.query(
            `INSERT INTO friendships (requester_id, addressee_id, status)
             VALUES ($1, $2, 'pending')
             RETURNING id, status;`,
            [me, addressee_id]
        );
        logger.info(`Friend request created: ${insert.rows[0].id} (me=${me} -> ${addressee_id})`);
        res.status(201).json({ message: 'Request sent', friendship: insert.rows[0] });
    } catch (error) {
        if (error.code === PG_UNIQUE_VIOLATION) {
            return res.status(409).json({ message: 'Friendship already exists' });
        }
        logger.error(`Friend request failed: ${error.message}`);
        res.status(500).json({ message: 'Request failed', error: error.message });
    }
});

// Accept a pending request — only the addressee can accept.
router.post('/api/friends/accept', requireAuth, async (req, res) => {
    const me = req.session.user_id;
    const { friendship_id } = req.body;

    if (!friendship_id) {
        return res.status(400).json({ message: 'friendship_id is required' });
    }

    try {
        const result = await db.query(
            `UPDATE friendships
             SET status = 'accepted', updated_at = NOW()
             WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
             RETURNING id, status;`,
            [friendship_id, me]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'No matching pending request for this user' });
        }
        logger.info(`Friendship ${friendship_id} accepted by user=${me}`);
        res.json({ message: 'Accepted', friendship: result.rows[0] });
    } catch (error) {
        logger.error(`Accept friend failed: ${error.message}`);
        res.status(500).json({ message: 'Accept failed', error: error.message });
    }
});

// Decline a pending request OR unfriend — anyone involved in the row can do it.
router.delete('/api/friends/:id', requireAuth, async (req, res) => {
    const me = req.session.user_id;
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
        return res.status(400).json({ message: 'Valid friendship id is required' });
    }

    try {
        const result = await db.query(
            `DELETE FROM friendships
             WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)
             RETURNING id;`,
            [id, me]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'No matching friendship for this user' });
        }
        logger.info(`Friendship ${id} removed by user=${me}`);
        res.json({ message: 'Removed', id });
    } catch (error) {
        logger.error(`Remove friend failed: ${error.message}`);
        res.status(500).json({ message: 'Remove failed', error: error.message });
    }
});

// Graph view: center user + direct friends + edges between those friends.
// Open social graph for now — any logged-in user can view any other user's graph.
router.get('/api/friends/graph', requireAuth, async (req, res) => {
    const targetId = req.query.user_id
        ? parseInt(req.query.user_id, 10)
        : req.session.user_id;

    if (!Number.isInteger(targetId) || targetId < 1) {
        return res.status(400).json({ message: 'Invalid user_id' });
    }

    try {
        const userResult = await db.query(
            'SELECT id, username, first_name, last_name FROM users WHERE id = $1',
            [targetId]
        );
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        const center = userResult.rows[0];

        // Direct friends of the target + each friend's total accepted-friend count.
        // Also includes the friendship row id between the VIEWER (me) and each
        // node — used to power the "remove friend" affordance on the viewer's
        // own tree. Null when the viewer isn't friends with that node.
        const friendsResult = await db.query(`
            WITH target_friends AS (
                SELECT
                    CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS friend_id
                FROM friendships
                WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'
            ),
            my_friendships AS (
                SELECT
                    id AS friendship_id,
                    CASE WHEN requester_id = $2 THEN addressee_id ELSE requester_id END AS friend_id
                FROM friendships
                WHERE (requester_id = $2 OR addressee_id = $2) AND status = 'accepted'
            )
            SELECT u.id, u.username, u.first_name, u.last_name,
                   mine.friendship_id,
                   (SELECT COUNT(*) FROM friendships f
                      WHERE (f.requester_id = u.id OR f.addressee_id = u.id)
                        AND f.status = 'accepted'
                   )::int AS friend_count
            FROM target_friends tf
            JOIN users u ON u.id = tf.friend_id
            LEFT JOIN my_friendships mine ON mine.friend_id = u.id
            ORDER BY u.username ASC
        `, [targetId, req.session.user_id]);

        const nodes = friendsResult.rows;
        const friendIds = nodes.map(n => n.id);

        // Mutual edges among the target's friends (which of them are friends with each other).
        let edges = [];
        if (friendIds.length >= 2) {
            const edgesResult = await db.query(`
                SELECT requester_id, addressee_id
                FROM friendships
                WHERE status = 'accepted'
                  AND requester_id = ANY($1::int[])
                  AND addressee_id = ANY($1::int[])
            `, [friendIds]);
            edges = edgesResult.rows.map(r => [r.requester_id, r.addressee_id]);
        }

        res.json({
            center,
            nodes,
            edges,
            is_me: targetId === req.session.user_id,
        });
    } catch (error) {
        logger.error(`Graph fetch failed: ${error.message}`);
        res.status(500).json({ message: 'Graph fetch failed', error: error.message });
    }
});

module.exports = router;
