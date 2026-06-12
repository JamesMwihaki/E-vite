const express = require('express');
const logger = require('../utils/logger');
const { requireAuth } = require('../middleware/auth');
const { runDueClusters, reverseGeocode } = require('../agent/event-scout');

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

// Cron target. Each user-city cluster runs once per local day, on the first
// tick past 5 AM local time. The vercel.json schedule is daily at 13:00 UTC
// (Hobby plan allows daily only; 13:00 UTC is past 5 AM in all US timezones) —
// on Pro, switch it to "0 * * * *" for exact 5 AM local runs. ?force=1 runs
// every cluster immediately (manual testing).
router.get('/api/agent/run', async (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
        const summary = await runDueClusters({ force: req.query.force === '1' });
        res.json(summary);
    } catch (error) {
        logger.error(`Agent run failed: ${error.message}`);
        res.status(500).json({ message: 'Agent run failed', error: error.message });
    }
});

module.exports = router;
