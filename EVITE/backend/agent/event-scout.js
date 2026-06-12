// Event-scout agent: discovers real public events near each user-cluster city
// (within 60 miles, no more than a month out) and saves them as public events.
//
// Discovery uses two sources merged by Claude:
//   1. Ticketmaster Discovery API — big structured listings (optional, needs key)
//   2. Claude + web search — local gems (bar gigs, park concerts), guided by the
//      agent_venues knowledge base, which the agent also grows on every run.
//
// Users sharing a city share one run. The cron calls runDueClusters(), which
// runs each cluster once per local day, on the first tick past 5 AM in that
// cluster's timezone (with a daily cron, that's the cron's own firing time).
const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');
const db = require('../db/database');

const RADIUS_MILES = 60;
const HORIZON_DAYS = 31;
const LOCAL_RUN_HOUR = 5;
const RUN_BUDGET_MS = 240 * 1000; // leave headroom under the function maxDuration
const FALLBACK_TZ = 'America/New_York';
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Lazy so an SDK problem (no key, Node < 18 without global fetch) degrades the
// scout to Ticketmaster-only instead of crashing the whole server at require.
let anthropicClient;
function getAnthropic() {
    if (anthropicClient !== undefined) return anthropicClient;
    try {
        anthropicClient = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
    } catch (err) {
        logger.warn(`Anthropic client unavailable: ${err.message}`);
        anthropicClient = null;
    }
    if (!anthropicClient) {
        logger.warn('Event scout running without Claude — Ticketmaster only');
    }
    return anthropicClient;
}

/* ---- per-timezone clock helpers ---- */

// "What time is it right now in this cluster's timezone?" Bad/missing
// timezones fall back to US Eastern rather than failing the whole run.
function localClock(timezone) {
    const tz = timezone || FALLBACK_TZ;
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz, hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
        }).formatToParts(new Date());
        const get = (type) => parts.find(p => p.type === type).value;
        return {
            date: `${get('year')}-${get('month')}-${get('day')}`,
            hour: Number(get('hour')) % 24,
        };
    } catch {
        return localClock(FALLBACK_TZ);
    }
}

function plusDays(isoDate, days) {
    const d = new Date(`${isoDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/* ---- discovery sources ---- */

async function geocode(city) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(city)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'evite-event-scout/1.0' } });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows.length) return null;
    return { lat: rows[0].lat, lon: rows[0].lon };
}

async function fetchTicketmaster(coords, startDate, endDate) {
    const key = process.env.TICKETMASTER_API_KEY;
    if (!key || !coords) return [];
    const params = new URLSearchParams({
        apikey: key,
        latlong: `${coords.lat},${coords.lon}`,
        radius: String(RADIUS_MILES),
        unit: 'miles',
        startDateTime: `${startDate}T00:00:00Z`,
        endDateTime: `${endDate}T23:59:59Z`,
        size: '25',
        sort: 'date,asc',
    });
    const res = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);
    if (!res.ok) {
        logger.warn(`Ticketmaster request failed: ${res.status}`);
        return [];
    }
    const data = await res.json();
    const events = data._embedded?.events || [];
    return events.map((e) => {
        const venue = e._embedded?.venues?.[0];
        return {
            title: e.name,
            date: e.dates?.start?.localDate || null,
            time: (e.dates?.start?.localTime || '19:00').slice(0, 5),
            venue: venue?.name || '',
            address: [venue?.address?.line1, venue?.city?.name, venue?.state?.stateCode]
                .filter(Boolean).join(', '),
            source_url: e.url || null,
            description: e.classifications?.[0]
                ? [e.classifications[0].segment?.name, e.classifications[0].genre?.name]
                    .filter(Boolean).join(' · ')
                : '',
        };
    }).filter(e => e.title && e.date);
}

async function askClaude(city, startDate, endDate, knownVenues, ticketmasterEvents) {
    const anthropic = getAnthropic();
    if (!anthropic) return { events: ticketmasterEvents, venues: [] };

    const system = `You are the E-vite event scout. You find real, verifiable public events
happening near a city — live music in bars, concerts in parks, soccer and other
sports games, markets, festivals — within ${RADIUS_MILES} miles, between ${startDate}
and ${endDate} (inclusive). Use web search to find and verify events; prefer
official venue pages, city calendars, and local listings.

You maintain a knowledge base of venues known for hosting events. Use it as a
starting point for where to look, and report new venues you learn about — but
do not limit your search to known venues.

Respond with ONLY a JSON object, no prose, in exactly this shape:
{
  "events": [
    {"title": "...", "description": "one or two sentences", "date": "YYYY-MM-DD",
     "time": "HH:MM", "venue": "...", "address": "...", "source_url": "https://..."}
  ],
  "venues": [
    {"name": "...", "notes": "what kind of events this place is known for"}
  ]
}
Rules: every event must be real and dated within the window. Include the
Ticketmaster events you were given only if they are inside the window, and add
distinct local events they miss. No duplicates — one entry per unique event.
Aim for 5-12 events total. If you cannot verify anything, return empty arrays.`;

    const userText = `City: ${city}

Known venues in the knowledge base:
${knownVenues.length
    ? knownVenues.map(v => `- ${v.name}: ${v.notes || 'no notes'}`).join('\n')
    : '(none yet)'}

Ticketmaster already found these (verify, dedupe, and supplement):
${JSON.stringify(ticketmasterEvents, null, 2)}`;

    const params = {
        model: 'claude-opus-4-8',
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        system,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }],
        messages: [{ role: 'user', content: userText }],
    };

    let response = await anthropic.messages.create(params);
    // Server-side web search can pause its loop; re-send to let it resume.
    for (let i = 0; i < 4 && response.stop_reason === 'pause_turn'; i++) {
        response = await anthropic.messages.create({
            ...params,
            messages: [
                { role: 'user', content: userText },
                { role: 'assistant', content: response.content },
            ],
        });
    }

    const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
    return parseAgentJson(text);
}

function parseAgentJson(text) {
    // The model is told to emit bare JSON, but tolerate code fences and
    // surrounding prose by slicing to the outermost braces.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('agent returned no JSON');
    const parsed = JSON.parse(text.slice(start, end + 1));
    return {
        events: Array.isArray(parsed.events) ? parsed.events : [],
        venues: Array.isArray(parsed.venues) ? parsed.venues : [],
    };
}

/* ---- persistence ---- */

async function getScoutUserId() {
    const res = await db.query(`SELECT id FROM users WHERE username = 'evite_scout'`);
    if (!res.rows.length) throw new Error('evite_scout user missing — run migrations');
    return res.rows[0].id;
}

function externalKey(title, date, venue) {
    return `${title}|${date}|${venue}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function saveEvents(city, events, startDate, endDate, scoutId) {
    let saved = 0;
    for (const e of events) {
        if (!e.title || !DATE_REGEX.test(e.date || '')) continue;
        if (e.date < startDate || e.date > endDate) continue;
        const time = /^\d{2}:\d{2}/.test(e.time || '') ? e.time.slice(0, 5) : '19:00';
        const location = [e.venue, e.address].filter(Boolean).join(' — ');
        const result = await db.query(
            `INSERT INTO events
                 (title, description, event_date, event_time, location, event_type,
                  creator_id, discovered, source_url, external_key, city)
             VALUES ($1, $2, $3, $4, $5, 'public', $6, TRUE, $7, $8, $9)
             ON CONFLICT (external_key) DO NOTHING
             RETURNING id`,
            [
                String(e.title).slice(0, 255), e.description || null, e.date, time,
                location || null, scoutId, e.source_url || null,
                externalKey(e.title, e.date, e.venue || ''), city,
            ]
        );
        saved += result.rows.length;
    }
    return saved;
}

async function saveVenues(city, venues) {
    for (const v of venues) {
        if (!v.name) continue;
        await db.query(
            `INSERT INTO agent_venues (city, name, notes)
             VALUES ($1, $2, $3)
             ON CONFLICT (city, name)
             DO UPDATE SET notes = COALESCE(EXCLUDED.notes, agent_venues.notes),
                           last_seen = NOW()`,
            [city, String(v.name).slice(0, 255), v.notes || null]
        );
    }
}

/* ---- run orchestration ---- */

async function runForCity(city, localDate) {
    const startDate = localDate;
    const endDate = plusDays(localDate, HORIZON_DAYS);
    const scoutId = await getScoutUserId();

    const coords = await geocode(city).catch((err) => {
        logger.warn(`Geocode failed for ${city}: ${err.message}`);
        return null;
    });
    const tmEvents = await fetchTicketmaster(coords, startDate, endDate)
        .catch((err) => {
            logger.warn(`Ticketmaster failed for ${city}: ${err.message}`);
            return [];
        });
    const venuesRes = await db.query(
        `SELECT name, notes FROM agent_venues WHERE LOWER(city) = LOWER($1)
         ORDER BY last_seen DESC LIMIT 30`,
        [city]
    );

    const { events, venues } = await askClaude(city, startDate, endDate, venuesRes.rows, tmEvents);
    const saved = await saveEvents(city, events, startDate, endDate, scoutId);
    await saveVenues(city, venues);

    logger.info(`Scout run for ${city}: ${events.length} candidates, ${saved} new, ${venues.length} venue notes`);
    return saved;
}

async function recordRun(city, runDate, status, eventsFound, detail) {
    await db.query(
        `INSERT INTO agent_runs (city, run_date, status, events_found, detail)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (city, run_date)
         DO UPDATE SET status = EXCLUDED.status,
                       events_found = EXCLUDED.events_found,
                       detail = EXCLUDED.detail`,
        [city, runDate, status, eventsFound, detail]
    );
}

// Entry point for the cron. Groups users by city, figures out each cluster's
// local time, and runs every cluster that is past 5 AM local and hasn't had a
// successful run today. `force` ignores the clock (manual triggering); a
// failed run is retried on the next tick because only 'ok' rows skip a city.
async function runDueClusters({ force = false } = {}) {
    const started = Date.now();
    const clusters = await db.query(
        `SELECT MIN(TRIM(location)) AS city,
                MODE() WITHIN GROUP (ORDER BY timezone) AS tz,
                COUNT(*)::int AS users
         FROM users
         WHERE location IS NOT NULL AND TRIM(location) <> ''
         GROUP BY LOWER(TRIM(location))`
    );

    const summary = { ran: [], skipped: [], errors: [] };
    for (const cluster of clusters.rows) {
        const { date: localDate, hour: localHour } = localClock(cluster.tz);

        if (!force) {
            if (localHour < LOCAL_RUN_HOUR) {
                summary.skipped.push({ city: cluster.city, reason: `local time ${localHour}:00 < ${LOCAL_RUN_HOUR}:00` });
                continue;
            }
            const already = await db.query(
                `SELECT 1 FROM agent_runs WHERE city = $1 AND run_date = $2 AND status = 'ok'`,
                [cluster.city, localDate]
            );
            if (already.rows.length) {
                summary.skipped.push({ city: cluster.city, reason: 'already ran today' });
                continue;
            }
        }
        if (Date.now() - started > RUN_BUDGET_MS) {
            summary.skipped.push({ city: cluster.city, reason: 'time budget — will retry next tick' });
            continue;
        }

        try {
            const saved = await runForCity(cluster.city, localDate);
            await recordRun(cluster.city, localDate, 'ok', saved, null);
            summary.ran.push({ city: cluster.city, new_events: saved });
        } catch (err) {
            logger.error(`Scout run failed for ${cluster.city}: ${err.message}`);
            await recordRun(cluster.city, localDate, 'error', 0, err.message)
                .catch(() => {});
            summary.errors.push({ city: cluster.city, error: err.message });
        }
    }
    return summary;
}

module.exports = { runDueClusters, runForCity };
