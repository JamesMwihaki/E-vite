// Load .env in non-production environments. In Vercel, env vars are injected
// directly so dotenv is a no-op (it just doesn't find a .env file).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { GoogleGenerativeAI } = require('@google/generative-ai');

const logger = require('./utils/logger');
const db = require('./db/database');
const eventsRouter = require('./routes/events');
const rsvpRouter = require('./routes/rsvp');
const invitationsRouter = require('./routes/invitations');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const friendsRouter = require('./routes/friends');
const agentRouter = require('./routes/agent');
const chatRouter = require('./routes/chat');

const port = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-change-me-in-production';
if (SESSION_SECRET === 'dev-only-change-me-in-production') {
    logger.warn('SESSION_SECRET is using the dev fallback — set it in env for production');
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    logger.warn('GEMINI_API_KEY not set — /api/ai_input will return 503');
}
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

const app = express();

// Trust the proxy in front of us (Vercel) so secure cookies + req.ip behave correctly.
app.set('trust proxy', 1);

// CORS: in production frontend + API share the same origin so this is mostly
// a no-op. `origin: true` keeps local-dev cross-origin work fine.
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use(session({
    store: new pgSession({
        pool: db.pool,
        tableName: 'session',
        createTableIfMissing: true,
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
}));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use(authRouter);
app.use(usersRouter);
app.use(friendsRouter);
app.use(eventsRouter);
app.use(rsvpRouter);
app.use(invitationsRouter);
app.use(agentRouter);
app.use(chatRouter);

app.post('/api/ai_input', async (req, res) => {
    if (!genAI) {
        return res.status(503).json({ message: 'AI not configured: set GEMINI_API_KEY' });
    }
    const { ask_ai } = req.body;
    if (!ask_ai) {
        return res.status(400).json({ message: 'ask_ai is required' });
    }

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent(ask_ai);
        const aiResponse = result.response.text();

        const insertText = `
            INSERT INTO messages (user_message, ai_response)
            VALUES ($1, $2)
            RETURNING id;
        `;
        const dbResult = await db.query(insertText, [ask_ai, aiResponse]);

        res.status(201).json({
            message: 'Success',
            aiResponse,
            messageId: dbResult.rows[0].id,
        });
    } catch (error) {
        logger.error(`AI request failed: ${error.message}`);
        res.status(500).json({ message: 'AI request failed', error: error.message });
    }
});

app.get('/api/ai_output', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id, user_message, ai_response FROM messages ORDER BY id DESC LIMIT 1'
        );
        res.json(result.rows[0] || null);
    } catch (error) {
        logger.error(`Fetch ai_output failed: ${error.message}`);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// Run migrations on startup. Idempotent (CREATE TABLE IF NOT EXISTS), so
// re-running on every Vercel cold start is fine.
const dbReady = db.connect_to_database().catch((err) => {
    logger.error(`Database init failed: ${err.message}`);
});

// Only listen when invoked directly (local dev: `node server.js`). When
// required as a module (Vercel api/index.js), the export below is enough.
if (require.main === module) {
    dbReady.then(() => {
        app.listen(port, () => {
            logger.info(`Server listening at http://localhost:${port}`);
        });
    });

    process.on('SIGINT', async () => {
        logger.info('Shutting down...');
        try { await db.pool.end(); } catch (err) {
            logger.error(`Error closing pool: ${err.message}`);
        }
        process.exit(0);
    });
}

module.exports = app;
