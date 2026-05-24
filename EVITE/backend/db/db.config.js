// Database connection config.
//
// Reads DATABASE_URL from the environment. Use the Supabase "Transaction
// Pooler" connection string (port 6543) in production — it's designed for
// short-lived serverless connections. Direct connection (port 5432) is fine
// for long-running local processes.
//
// Locally: put DATABASE_URL in EVITE/.env (loaded by dotenv in server.js).

const isProd = process.env.NODE_ENV === 'production';

if (!process.env.DATABASE_URL) {
    if (isProd) {
        throw new Error('DATABASE_URL is required in production');
    }
    // Local dev fallback to a docker-compose Postgres, for users not yet on Supabase.
    console.warn('[db] DATABASE_URL not set — falling back to local docker-compose config');
}

module.exports = process.env.DATABASE_URL
    ? {
          connectionString: process.env.DATABASE_URL,
          // Supabase requires SSL. The pooler uses a self-signed cert, so we
          // skip strict verification — fine for an app-level connection.
          ssl: { rejectUnauthorized: false },
      }
    : {
          user: process.env.DB_USER || 'James',
          host: process.env.DB_HOST || 'db',
          database: process.env.DB_NAME || 'grain_store',
          password: process.env.DB_PASSWORD || 'fullStack2025',
          port: Number(process.env.DB_PORT) || 5432,
      };
