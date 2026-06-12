const express = require('express');
const logger = require('../utils/logger');
const { runDueClusters } = require('../agent/event-scout');

const router = express.Router();

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
