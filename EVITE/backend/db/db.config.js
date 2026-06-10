// Database connection config.
//
// Reads DATABASE_URL from the environment. Use the Supabase "Transaction
// Pooler" connection string (port 6543) in production — it's designed for
// short-lived serverless connections. Direct connection (port 5432) is fine
// for long-running local processes.
//
// Locally: put DATABASE_URL in EVITE/.env (loaded by dotenv in server.js).

if (!process.env.DATABASE_URL) {
    throw new Error(
        'DATABASE_URL is not set. Copy EVITE/.env.example to EVITE/.env and paste your Supabase connection string.'
    );
}

// Local Postgres usually runs without SSL; Supabase requires it. The pooler
// uses a self-signed cert, so we skip strict verification — fine for an
// app-level connection.
const isLocalDb = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

module.exports = {
    connectionString: process.env.DATABASE_URL,
    ssl: isLocalDb ? false : { rejectUnauthorized: false },
};
