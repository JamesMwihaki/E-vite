const express = require('express');
const logger = require('../utils/logger');
const db = require('../db/database');
const { hashPassword, verifyPassword } = require('../utils/passwords');
const { runCityIfDue, isCityDue, geocode } = require('../agent/event-scout');

// On Vercel, work kicked off after the response needs waitUntil to keep the
// function alive. Locally (plain node server) a floating promise is fine.
let waitUntil = (promise) => { promise.catch(() => {}); };
try { ({ waitUntil } = require('@vercel/functions')); } catch { /* local dev */ }

const router = express.Router();

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PG_UNIQUE_VIOLATION = '23505';

router.post('/api/signup', async (req, res) => {
    const { username, email, password, first_name, last_name } = req.body;

    if (!username || !USERNAME_REGEX.test(username)) {
        return res.status(400).json({ message: 'Username must be 3-30 chars, letters/numbers/underscore only' });
    }
    if (!email || !EMAIL_REGEX.test(email)) {
        return res.status(400).json({ message: 'Valid email is required' });
    }
    if (!password || password.length < 8) {
        return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    try {
        const password_hash = await hashPassword(password);
        const result = await db.query(
            `INSERT INTO users (username, email, password_hash, first_name, last_name)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, username, email, first_name, last_name;`,
            [username, email, password_hash, first_name || null, last_name || null]
        );
        const user = result.rows[0];
        req.session.user_id = user.id;
        logger.info(`Signup: user_id=${user.id} username=${user.username}`);
        res.status(201).json({ user });
    } catch (error) {
        if (error.code === PG_UNIQUE_VIOLATION) {
            return res.status(409).json({ message: 'Username or email already taken' });
        }
        logger.error(`Signup failed: ${error.message}`);
        res.status(500).json({ message: 'Signup failed', error: error.message });
    }
});

router.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'username and password are required' });
    }

    try {
        const result = await db.query(
            'SELECT id, username, email, first_name, last_name, password_hash FROM users WHERE username = $1',
            [username]
        );

        const user = result.rows[0];
        const ok = user && await verifyPassword(password, user.password_hash);

        if (!ok) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        req.session.user_id = user.id;
        const { password_hash, ...safeUser } = user;
        logger.info(`Login: user_id=${user.id} username=${user.username}`);
        res.json({ user: safeUser });
    } catch (error) {
        logger.error(`Login failed: ${error.message}`);
        res.status(500).json({ message: 'Login failed', error: error.message });
    }
});

router.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            logger.error(`Logout failed: ${err.message}`);
            return res.status(500).json({ message: 'Logout failed' });
        }
        res.clearCookie('connect.sid');
        res.json({ message: 'Logged out' });
    });
});

router.get('/api/me', async (req, res) => {
    if (!req.session || !req.session.user_id) {
        return res.status(401).json({ message: 'Not authenticated' });
    }
    try {
        const result = await db.query(
            'SELECT id, username, email, first_name, last_name, location, created_at FROM users WHERE id = $1',
            [req.session.user_id]
        );
        if (result.rows.length === 0) {
            req.session.destroy(() => {});
            return res.status(401).json({ message: 'Session invalid' });
        }
        res.json({ user: result.rows[0] });
    } catch (error) {
        logger.error(`/api/me failed: ${error.message}`);
        res.status(500).json({ message: 'Failed to fetch user', error: error.message });
    }
});

router.get('/api/me/stats', async (req, res) => {
    if (!req.session || !req.session.user_id) {
        return res.status(401).json({ message: 'Not authenticated' });
    }
    const me = req.session.user_id;
    try {
        const [friendsRes, createdRes, goingRes] = await Promise.all([
            db.query(
                `SELECT COUNT(*)::int AS c FROM friendships
                 WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'`,
                [me]
            ),
            db.query(
                `SELECT COUNT(*)::int AS c FROM events WHERE creator_id = $1`,
                [me]
            ),
            db.query(
                `SELECT COUNT(*)::int AS c FROM rsvps WHERE user_id = $1 AND status = 'going'`,
                [me]
            ),
        ]);
        res.json({
            friends: friendsRes.rows[0].c,
            events_created: createdRes.rows[0].c,
            events_going: goingRes.rows[0].c,
        });
    } catch (error) {
        logger.error(`/api/me/stats failed: ${error.message}`);
        res.status(500).json({ message: 'Failed to fetch stats', error: error.message });
    }
});

router.put('/api/me', async (req, res) => {
    if (!req.session || !req.session.user_id) {
        return res.status(401).json({ message: 'Not authenticated' });
    }
    const { first_name, last_name, email, location, timezone, latitude, longitude } = req.body;
    if (!email || !EMAIL_REGEX.test(email)) {
        return res.status(400).json({ message: 'Valid email is required' });
    }
    try {
        const prev = await db.query(
            'SELECT location, timezone, latitude, longitude FROM users WHERE id = $1',
            [req.session.user_id]
        );

        // Coordinates power the 60-mile visibility radius for discovered
        // events. Prefer the device coordinates sent with a detected location;
        // for a hand-typed city, geocode it; keep the old ones when the
        // location didn't change; clear them when the location is cleared.
        const newLocation = (location || '').trim() || null;
        const oldLocationNorm = (prev.rows[0]?.location || '').trim().toLowerCase();
        const changed = (newLocation || '').toLowerCase() !== oldLocationNorm;
        let lat = latitude !== null && Number.isFinite(Number(latitude))
            && Math.abs(Number(latitude)) <= 90 ? Number(latitude) : null;
        let lon = longitude !== null && Number.isFinite(Number(longitude))
            && Math.abs(Number(longitude)) <= 180 ? Number(longitude) : null;
        if (newLocation && (lat === null || lon === null)) {
            if (!changed) {
                lat = prev.rows[0]?.latitude ?? null;
                lon = prev.rows[0]?.longitude ?? null;
            } else {
                const coords = await geocode(newLocation).catch(() => null);
                lat = coords ? Number(coords.lat) : null;
                lon = coords ? Number(coords.lon) : null;
            }
        }
        if (!newLocation) { lat = null; lon = null; }

        // location opts the user into nearby-event discovery; timezone comes
        // from the browser so the scout can run at 5 AM local time.
        const result = await db.query(
            `UPDATE users SET first_name = $1, last_name = $2, email = $3,
                              location = $4, timezone = COALESCE($5, timezone),
                              latitude = $6, longitude = $7
             WHERE id = $8
             RETURNING id, username, email, first_name, last_name, location, timezone, created_at`,
            [first_name || null, last_name || null, email,
             newLocation, (timezone || '').trim() || null, lat, lon,
             req.session.user_id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        logger.info(`Profile updated for user_id=${req.session.user_id}`);

        // A changed location kicks off the event scout for the new city right
        // away (in the background) instead of waiting for the daily cron —
        // unless that city was already scouted today.
        let scouting = false;
        if (newLocation && changed) {
            const tz = result.rows[0].timezone;
            if (await isCityDue(newLocation, tz)) {
                scouting = true;
                waitUntil(
                    runCityIfDue(newLocation, tz)
                        .then((r) => logger.info(`Location-change scout for ${newLocation}: ${JSON.stringify(r)}`))
                        .catch((err) => logger.error(`Location-change scout failed: ${err.message}`))
                );
            }
        }

        res.json({ user: result.rows[0], scouting });
    } catch (error) {
        if (error.code === PG_UNIQUE_VIOLATION) {
            return res.status(409).json({ message: 'Email already taken' });
        }
        logger.error(`PUT /api/me failed: ${error.message}`);
        res.status(500).json({ message: 'Update failed', error: error.message });
    }
});

router.post('/api/me/password', async (req, res) => {
    if (!req.session || !req.session.user_id) {
        return res.status(401).json({ message: 'Not authenticated' });
    }
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
        return res.status(400).json({ message: 'current_password and new_password are required' });
    }
    if (new_password.length < 8) {
        return res.status(400).json({ message: 'New password must be at least 8 characters' });
    }

    try {
        const result = await db.query(
            'SELECT password_hash FROM users WHERE id = $1',
            [req.session.user_id]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Session invalid' });
        }
        const ok = await verifyPassword(current_password, result.rows[0].password_hash);
        if (!ok) {
            return res.status(401).json({ message: 'Current password is incorrect' });
        }
        const newHash = await hashPassword(new_password);
        await db.query(
            'UPDATE users SET password_hash = $1 WHERE id = $2',
            [newHash, req.session.user_id]
        );
        logger.info(`Password changed for user_id=${req.session.user_id}`);
        res.json({ message: 'Password updated' });
    } catch (error) {
        logger.error(`Password change failed: ${error.message}`);
        res.status(500).json({ message: 'Password change failed', error: error.message });
    }
});

module.exports = router;
