const logger = require('../utils/logger');
const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
const dbConfig = require('./db.config');

const pool = new Pool(dbConfig);

pool.on('error', (err) => {
    logger.error(`Postgres idle client error: ${err.message}`);
});

async function connect_to_database() {
    const migrationPath = path.join(__dirname, '..', 'migrations', 'create_tables.sql');
    const sql = await fs.readFile(migrationPath, 'utf-8');
    await pool.query(sql);
    logger.info('Database connected; tables ensured');
}

module.exports = {
    pool,
    connect_to_database,
    query: (text, params) => pool.query(text, params),
};
