module.exports = {
    user: process.env.DB_USER || 'James',
    host: process.env.DB_HOST || 'db', 
    database: process.env.DB_NAME || 'grain_store',
    password: process.env.DB_PASSWORD || 'fullStack2025',
    port: process.env.DB_PORT || 5432,
};
