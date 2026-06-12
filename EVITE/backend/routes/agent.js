const express = require('express');
const logger = require('../utils/logger');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { runDueClusters, reverseGeocode, suggestCities } = require('../agent/event-scout');

const router = express.Router();

// Browser geolocation support: the profile page sends device coordinates and
// gets back a "City, ST" string for the location field. Manual typing remains
// the fallback when permission is denied or detection fails.
router.get('/api/geo/locate', requireAuth, async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)
        || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        return res.status(400).json({ message: 'lat and lon are required' });
    }
    try {
        const place = await reverseGeocode(lat, lon);
        if (!place) {
            return res.status(404).json({ message: 'Could not determine a city from your location' });
        }
        res.json({ location: place });
    } catch (error) {
        logger.error(`Reverse geocode failed: ${error.message}`);
        res.status(500).json({ message: 'Location lookup failed' });
    }
});

// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" automatically when
// the CRON_SECRET env var is set. Without the secret configured the endpoint
// stays open (local dev) but logs a warning.
function isAuthorized(req) {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        logger.warn('CRON_SECRET not set — /api/agent/run is unprotected');
        return true;
    }
    return req.headers.authorization === `Bearer ${secret}`;
}

// Location-field typeahead: partial text -> up to 5 canonical "City, ST"
// suggestions with coordinates. Keeps spellings consistent so city clusters
// don't fragment.
router.get('/api/geo/suggest', requireAuth, async (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    try {
        // Bias ranking toward the user's stored coordinates when available.
        const me = await db.query(
            'SELECT latitude AS lat, longitude AS lon FROM users WHERE id = $1',
            [req.session.user_id]
        );
        const bias = me.rows[0]?.lat != null ? me.rows[0] : null;
        res.json(await suggestCities(q, bias));
    } catch (error) {
        logger.error(`City suggest failed: ${error.message}`);
        res.json([]); // typeahead is best-effort; an empty list degrades gracefully
    }
});

// Cron target. Each user-city cluster runs once per local day, on the first
// tick past 5 AM local time. The vercel.json schedule is daily at 13:00 UTC
// (Hobby plan allows daily only; 13:00 UTC is past 5 AM in all US timezones) —
// on Pro, switch it to "0 * * * *" for exact 5 AM local runs. ?force=1 runs
// every cluster immediately (manual testing).
// Passed public events get discarded — unless an exclusive e-vite was forked
// from them, in which case the row stays so the fork's "Based on" link keeps
// working. Times are stored without a timezone and NOW() is UTC, so the 13h
// grace (12h max westward offset + the 1h linger) guarantees nothing is
// deleted before it's truly over anywhere; the frontend handles the precise
// hide-after-one-hour in the viewer's local time. RSVPs and invitations go
// with the event via ON DELETE CASCADE.
async function cleanupPassedPublicEvents() {
    const result = await db.query(
        `DELETE FROM events e
         WHERE e.event_type = 'public'
           AND (e.event_date + e.event_time) < NOW() - INTERVAL '13 hours'
           AND NOT EXISTS (
               SELECT 1 FROM events f WHERE f.source_event_id = e.id
           )
         RETURNING e.id`
    );
    if (result.rows.length) {
        logger.info(`Cleanup: discarded ${result.rows.length} passed public event(s)`);
    }
    return result.rows.length;
}

router.get('/api/agent/run', async (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
        const discarded = await cleanupPassedPublicEvents()
            .catch((err) => {
                logger.error(`Cleanup failed: ${err.message}`);
                return 0;
            });
        const summary = await runDueClusters({ force: req.query.force === '1' });
        res.json({ ...summary, discarded });
    } catch (error) {
        logger.error(`Agent run failed: ${error.message}`);
        res.status(500).json({ message: 'Agent run failed', error: error.message });
    }
});

module.exports = router;
