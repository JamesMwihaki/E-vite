// Gmail connection routes: OAuth connect/callback, status, manual sync,
// disconnect, and the cron target that syncs all connected inboxes.
//
// The refresh token is stored server-side (gmail_accounts) with read-only
// scope; the mail-scout agent uses it to scan for event flyers.
const express = require('express');
const crypto = require('crypto');
const logger = require('../utils/logger');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const mailScout = require('../agent/mail-scout');

const router = express.Router();

// The redirect URI must exactly match one registered in the Google Cloud
// console. APP_BASE_URL wins so prod always uses the canonical domain;
// locally the request host (http://localhost:3001) is used.
function callbackUrl(req) {
    const base = process.env.APP_BASE_URL
        || `${req.protocol}://${req.get('host')}`;
    return `${base.replace(/\/$/, '')}/api/gmail/callback`;
}

// Where to land the browser after the OAuth dance. /profile is a vercel.json
// redirect in prod; locally the API has no static frontend, so the query
// params are the only feedback either way.
function profileUrl(result) {
    return `/profile?gmail=${encodeURIComponent(result)}`;
}

// Kick off OAuth: remember a state nonce in the session (CSRF guard) and
// send the browser to Google's consent screen.
router.get('/api/gmail/connect', requireAuth, (req, res) => {
    if (!mailScout.oauthConfigured()) {
        return res.status(503).json({
            message: 'Gmail is not configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET',
        });
    }
    const state = crypto.randomBytes(24).toString('hex');
    req.session.gmail_oauth_state = state;
    res.redirect(mailScout.buildAuthUrl(callbackUrl(req), state));
});

// Google sends the browser back here with ?code (or ?error if denied).
router.get('/api/gmail/callback', requireAuth, async (req, res) => {
    const { code, state, error } = req.query;
    const expected = req.session.gmail_oauth_state;
    delete req.session.gmail_oauth_state;

    if (error) return res.redirect(profileUrl('denied'));
    if (!code || !state || state !== expected) {
        return res.redirect(profileUrl('error'));
    }
    try {
        const tokens = await mailScout.exchangeCode(code, callbackUrl(req));
        if (!tokens.refresh_token) {
            // prompt=consent should always yield one; without it the cron
            // couldn't read mail later, so treat as a failed connect.
            logger.warn('Gmail connect returned no refresh token');
            return res.redirect(profileUrl('error'));
        }
        const profile = await mailScout.fetchGmailProfile(tokens.access_token);
        await db.query(
            `INSERT INTO gmail_accounts (user_id, email, refresh_token)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id)
             DO UPDATE SET email = EXCLUDED.email,
                           refresh_token = EXCLUDED.refresh_token,
                           connected_at = NOW(),
                           last_status = NULL, last_detail = NULL`,
            [req.session.user_id, profile.emailAddress, tokens.refresh_token]
        );
        logger.info(`Gmail connected for user ${req.session.user_id} (${profile.emailAddress})`);
        res.redirect(profileUrl('connected'));
    } catch (err) {
        logger.error(`Gmail callback failed: ${err.message}`);
        res.redirect(profileUrl('error'));
    }
});

router.get('/api/gmail/status', requireAuth, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT a.email, a.connected_at, a.last_synced_at, a.last_status,
                    a.last_events_found,
                    (SELECT COALESCE(SUM(m.events_found), 0)::int
                     FROM gmail_messages m WHERE m.account_id = a.id) AS total_events
             FROM gmail_accounts a WHERE a.user_id = $1`,
            [req.session.user_id]
        );
        if (!result.rows.length) {
            return res.json({ connected: false, configured: mailScout.oauthConfigured() });
        }
        res.json({ connected: true, configured: true, ...result.rows[0] });
    } catch (err) {
        logger.error(`Gmail status failed: ${err.message}`);
        res.status(500).json({ message: 'Status lookup failed' });
    }
});

// What the scout has looked at and what each email yielded — the trust view
// for "why isn't my flyer showing up?".
router.get('/api/gmail/messages', requireAuth, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT m.subject, m.events_found, m.processed_at
             FROM gmail_messages m
             JOIN gmail_accounts a ON a.id = m.account_id
             WHERE a.user_id = $1
             ORDER BY m.processed_at DESC
             LIMIT 25`,
            [req.session.user_id]
        );
        res.json(result.rows);
    } catch (err) {
        logger.error(`Gmail scan log failed: ${err.message}`);
        res.status(500).json({ message: 'Scan log lookup failed' });
    }
});

// Manual "check now" from the profile page. Runs inline — the 300s function
// budget covers a capped run, and the response reports what was found.
// { rescan: true } forgets every already-scanned email that yielded nothing,
// so improved extraction gets another look at them.
router.post('/api/gmail/sync', requireAuth, async (req, res) => {
    try {
        const account = await db.query(
            'SELECT * FROM gmail_accounts WHERE user_id = $1',
            [req.session.user_id]
        );
        if (!account.rows.length) {
            return res.status(404).json({ message: 'No Gmail account connected' });
        }
        if (req.body && req.body.rescan) {
            const cleared = await db.query(
                'DELETE FROM gmail_messages WHERE account_id = $1 AND events_found = 0 RETURNING id',
                [account.rows[0].id]
            );
            logger.info(`Gmail rescan: requeued ${cleared.rows.length} zero-event message(s)`);
        }
        const result = await mailScout.syncAccount(account.rows[0]);
        res.json(result);
    } catch (err) {
        logger.error(`Gmail sync failed: ${err.message}`);
        const revoked = err.code === 'invalid_grant';
        res.status(revoked ? 409 : 500).json({
            message: revoked
                ? 'Google access was revoked — reconnect your Gmail'
                : 'Sync failed',
        });
    }
});

router.delete('/api/gmail', requireAuth, async (req, res) => {
    try {
        const result = await db.query(
            'DELETE FROM gmail_accounts WHERE user_id = $1 RETURNING refresh_token',
            [req.session.user_id]
        );
        if (result.rows.length) {
            await mailScout.revokeToken(result.rows[0].refresh_token);
        }
        res.json({ message: 'Disconnected' });
    } catch (err) {
        logger.error(`Gmail disconnect failed: ${err.message}`);
        res.status(500).json({ message: 'Disconnect failed' });
    }
});

// Cron target (separate from /api/agent/run so the two scouts don't share
// one 300s budget). Same CRON_SECRET convention.
router.get('/api/gmail/run', async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.authorization !== `Bearer ${secret}`) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    if (!secret) logger.warn('CRON_SECRET not set — /api/gmail/run is unprotected');
    try {
        const summary = await mailScout.syncAllAccounts();
        res.json(summary);
    } catch (err) {
        logger.error(`Mail scout run failed: ${err.message}`);
        res.status(500).json({ message: 'Mail scout run failed', error: err.message });
    }
});

module.exports = router;
