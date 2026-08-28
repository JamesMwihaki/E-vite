// Mail-scout agent: reads event flyers out of a connected Gmail inbox and
// saves them as discovered events, alongside what the web event-scout finds.
//
// Flow: the user connects Gmail once via OAuth (routes/gmail.js stores the
// refresh token). Each run lists recent inbox messages, skips ones already
// processed, and hands each new message — body text plus image/PDF
// attachments, which is how school event flyers usually arrive — to Claude
// to decide whether it announces events and extract them as structured JSON.
//
// Read-only scope (gmail.readonly); nothing is ever sent, labeled, or deleted.
const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');
const db = require('../db/database');
const { localClock } = require('./event-scout');

const SEARCH_QUERY = 'newer_than:14d in:inbox';
const MAX_MESSAGES_PER_RUN = 10; // Claude call per message — keep runs bounded
const HORIZON_DAYS = 90; // school flyers announce whole-semester events
const RUN_BUDGET_MS = 240 * 1000; // headroom under the 300s function cap
const FETCH_TIMEOUT_MS = 15 * 1000;
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024; // Claude's per-image comfort zone
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

let anthropicClient;
function getAnthropic() {
    if (anthropicClient !== undefined) return anthropicClient;
    try {
        anthropicClient = process.env.ANTHROPIC_API_KEY
            ? new Anthropic({ timeout: 120 * 1000 })
            : null;
    } catch (err) {
        logger.warn(`Anthropic client unavailable: ${err.message}`);
        anthropicClient = null;
    }
    if (!anthropicClient) {
        logger.warn('Mail scout disabled — ANTHROPIC_API_KEY not set');
    }
    return anthropicClient;
}

/* ---- Google OAuth (raw fetch — the full googleapis SDK is overkill) ---- */

const OAUTH_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

function oauthConfigured() {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function buildAuthUrl(redirectUri, state) {
    const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: OAUTH_SCOPE,
        access_type: 'offline', // ask for a refresh token
        prompt: 'consent',      // re-issue the refresh token on reconnect
        state,
    });
    return `${AUTH_ENDPOINT}?${params}`;
}

async function tokenRequest(body) {
    const res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.error_description || data.error || `token request failed (${res.status})`);
        err.code = data.error;
        throw err;
    }
    return data;
}

async function exchangeCode(code, redirectUri) {
    return tokenRequest({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
    });
}

async function refreshAccessToken(refreshToken) {
    return tokenRequest({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
    });
}

async function revokeToken(refreshToken) {
    await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(refreshToken)}`, {
        method: 'POST',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).catch(() => {}); // best-effort — the row is deleted regardless
}

async function gmailGet(accessToken, path) {
    const res = await fetch(`${GMAIL_API}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
        throw new Error(`Gmail API ${path.split('?')[0]} failed (${res.status})`);
    }
    return res.json();
}

async function fetchGmailProfile(accessToken) {
    return gmailGet(accessToken, '/profile');
}

/* ---- message content extraction ---- */

function base64UrlDecode(data) {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// Crude but sufficient HTML -> text for flyers: the point is to hand Claude
// legible content, not to render faithfully.
function htmlToText(html) {
    return html
        .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*\n+/g, '\n\n')
        .trim();
}

function headerValue(headers, name) {
    const h = (headers || []).find(x => x.name?.toLowerCase() === name.toLowerCase());
    return h ? h.value : '';
}

// Walk the MIME tree collecting plain text, html (fallback), and attachment
// pointers worth showing to Claude (images and PDFs — how flyers travel).
function collectParts(part, out) {
    if (!part) return;
    const mime = (part.mimeType || '').toLowerCase();
    if (mime === 'text/plain' && part.body?.data) {
        out.text += base64UrlDecode(part.body.data).toString('utf8') + '\n';
    } else if (mime === 'text/html' && part.body?.data) {
        out.html += base64UrlDecode(part.body.data).toString('utf8');
    } else if ((IMAGE_TYPES.has(mime) || mime === 'application/pdf') && part.body?.attachmentId) {
        out.attachments.push({
            attachmentId: part.body.attachmentId,
            mimeType: mime,
            size: part.body.size || 0,
        });
    }
    for (const child of part.parts || []) collectParts(child, out);
}

async function loadMessageContent(accessToken, gmailId) {
    const msg = await gmailGet(accessToken, `/messages/${gmailId}?format=full`);
    const out = { text: '', html: '', attachments: [] };
    collectParts(msg.payload, out);

    const content = {
        gmailId,
        subject: headerValue(msg.payload?.headers, 'Subject'),
        from: headerValue(msg.payload?.headers, 'From'),
        date: headerValue(msg.payload?.headers, 'Date'),
        body: (out.text.trim() || htmlToText(out.html)).slice(0, 20000),
        blocks: [],
    };

    const usable = out.attachments
        .filter(a => a.size <= MAX_ATTACHMENT_BYTES)
        .slice(0, MAX_ATTACHMENTS);
    for (const att of usable) {
        try {
            const data = await gmailGet(accessToken,
                `/messages/${gmailId}/attachments/${att.attachmentId}`);
            const b64 = Buffer.from(base64UrlDecode(data.data)).toString('base64');
            content.blocks.push(att.mimeType === 'application/pdf'
                ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
                : { type: 'image', source: { type: 'base64', media_type: att.mimeType, data: b64 } });
        } catch (err) {
            logger.warn(`Attachment fetch failed for ${gmailId}: ${err.message}`);
        }
    }
    return content;
}

/* ---- Claude extraction ---- */

async function extractEvents(content, todayDate, endDate, timezone) {
    const anthropic = getAnthropic();
    if (!anthropic) return [];

    const system = `You read one email and decide whether it announces real upcoming
events (school event flyers, club announcements, campus newsletters, community
event invites). Today's date is ${todayDate} (${timezone || 'local time'}).

Extract ONLY events with a concrete calendar date between ${todayDate} and
${endDate}. Resolve relative dates ("this Friday", "next Tuesday") against
today's date and the email's sent date. Skip anything without a determinable
date, recurring "every week" listings without specific dates, deadlines that
aren't attendable events, and pure marketing.

Respond with ONLY a JSON object, no prose:
{
  "events": [
    {"title": "...", "description": "one or two sentences; include cost/free and who it's for when stated",
     "date": "YYYY-MM-DD", "time": "HH:MM", "venue": "...", "address": "...",
     "source_url": "https://... (a link from the email itself, or null)"}
  ]
}
If a flyer lists several events, extract each one. If the email announces no
attendable events, return {"events": []}. Use 24-hour time; if no time is
given use "12:00".`;

    const userBlocks = [
        {
            type: 'text',
            text: `From: ${content.from}\nSubject: ${content.subject}\nSent: ${content.date}\n\n${content.body || '(no text body — see attachments)'}`,
        },
        ...content.blocks,
    ];

    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system,
        messages: [{ role: 'user', content: userBlocks }],
    });

    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return [];
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed.events) ? parsed.events : [];
}

/* ---- persistence (mirrors event-scout's dedupe scheme) ---- */

function normalizeKeyPart(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function externalKey(title, date, venue) {
    return [normalizeKeyPart(title), date, normalizeKeyPart(venue)].join('|');
}

async function getScoutUserId() {
    const res = await db.query(`SELECT id FROM users WHERE username = 'evite_scout'`);
    if (!res.rows.length) throw new Error('evite_scout user missing — run migrations');
    return res.rows[0].id;
}

async function saveEvents(events, owner, gmailId, todayDate, endDate, scoutId) {
    let saved = 0;
    for (const e of events) {
        if (!e.title || !DATE_REGEX.test(e.date || '')) continue;
        if (e.date < todayDate || e.date > endDate) continue;
        const time = /^\d{2}:\d{2}/.test(e.time || '') ? e.time.slice(0, 5) : '12:00';
        const location = [e.venue, e.address].filter(Boolean).join(' — ');
        // No link in the email itself -> deep-link to the source message, so
        // the account owner can jump back to the original flyer.
        const sourceUrl = e.source_url || `https://mail.google.com/mail/u/0/#all/${gmailId}`;
        const result = await db.query(
            `INSERT INTO events
                 (title, description, event_date, event_time, location, event_type,
                  creator_id, discovered, source_url, external_key, city, latitude, longitude)
             VALUES ($1, $2, $3, $4, $5, 'public', $6, TRUE, $7, $8, $9, $10, $11)
             ON CONFLICT (external_key) DO NOTHING
             RETURNING id`,
            [
                String(e.title).slice(0, 255), e.description || null, e.date, time,
                location || null, scoutId, sourceUrl,
                externalKey(e.title, e.date, e.venue || ''),
                owner.location || null, owner.latitude, owner.longitude,
            ]
        );
        saved += result.rows.length;
    }
    return saved;
}

/* ---- sync orchestration ---- */

// One connected account: refresh the token, list recent messages, process the
// ones we haven't seen. Returns {checked, events_found} for the UI.
async function syncAccount(account, { budgetMs = RUN_BUDGET_MS } = {}) {
    const started = Date.now();
    let tokens;
    try {
        tokens = await refreshAccessToken(account.refresh_token);
    } catch (err) {
        // invalid_grant = the user revoked access in their Google account —
        // surface it so the profile page can prompt a reconnect.
        const status = err.code === 'invalid_grant' ? 'revoked' : 'error';
        await recordSync(account.id, status, 0, err.message);
        throw err;
    }
    const accessToken = tokens.access_token;

    const owner = (await db.query(
        'SELECT location, latitude, longitude, timezone FROM users WHERE id = $1',
        [account.user_id]
    )).rows[0] || {};
    const { date: todayDate } = localClock(owner.timezone);
    const endDate = plusDays(todayDate, HORIZON_DAYS);
    const scoutId = await getScoutUserId();

    const list = await gmailGet(accessToken,
        `/messages?q=${encodeURIComponent(SEARCH_QUERY)}&maxResults=25`);
    const ids = (list.messages || []).map(m => m.id);
    if (!ids.length) {
        await recordSync(account.id, 'ok', 0, null);
        return { checked: 0, events_found: 0 };
    }

    const seen = await db.query(
        'SELECT gmail_id FROM gmail_messages WHERE account_id = $1 AND gmail_id = ANY($2)',
        [account.id, ids]
    );
    const seenIds = new Set(seen.rows.map(r => r.gmail_id));
    const fresh = ids.filter(id => !seenIds.has(id)).slice(0, MAX_MESSAGES_PER_RUN);

    let checked = 0;
    let totalFound = 0;
    for (const gmailId of fresh) {
        if (Date.now() - started > budgetMs) break; // rest picked up next run
        try {
            const content = await loadMessageContent(accessToken, gmailId);
            const events = await extractEvents(content, todayDate, endDate, owner.timezone);
            const saved = await saveEvents(events, owner, gmailId, todayDate, endDate, scoutId);
            await db.query(
                `INSERT INTO gmail_messages (account_id, gmail_id, subject, events_found)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (account_id, gmail_id) DO NOTHING`,
                [account.id, gmailId, (content.subject || '').slice(0, 255), saved]
            );
            checked++;
            totalFound += saved;
            if (saved) logger.info(`Mail scout: ${saved} event(s) from "${content.subject}"`);
        } catch (err) {
            // Leave the message unrecorded so a transient failure retries
            // next run; a poison message just costs one attempt per run.
            logger.warn(`Mail scout failed on message ${gmailId}: ${err.message}`);
        }
    }

    await recordSync(account.id, 'ok', totalFound, null);
    return { checked, events_found: totalFound };
}

function plusDays(isoDate, days) {
    const d = new Date(`${isoDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

async function recordSync(accountId, status, eventsFound, detail) {
    await db.query(
        `UPDATE gmail_accounts
         SET last_synced_at = NOW(), last_status = $2, last_events_found = $3, last_detail = $4
         WHERE id = $1`,
        [accountId, status, eventsFound, detail]
    ).catch(err => logger.warn(`recordSync failed: ${err.message}`));
}

// Cron entry point: sync every connected account, splitting the time budget.
async function syncAllAccounts() {
    const accounts = await db.query('SELECT * FROM gmail_accounts ORDER BY id');
    const summary = { synced: [], errors: [] };
    if (!accounts.rows.length) return summary;
    const budgetMs = Math.floor(RUN_BUDGET_MS / accounts.rows.length);
    for (const account of accounts.rows) {
        try {
            const result = await syncAccount(account, { budgetMs });
            summary.synced.push({ email: account.email, ...result });
        } catch (err) {
            logger.error(`Mail sync failed for ${account.email}: ${err.message}`);
            summary.errors.push({ email: account.email, error: err.message });
        }
    }
    return summary;
}

module.exports = {
    oauthConfigured, buildAuthUrl, exchangeCode, revokeToken, fetchGmailProfile,
    syncAccount, syncAllAccounts, OAUTH_SCOPE,
};
