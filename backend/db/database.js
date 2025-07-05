const logger = require('../utils/logger'); 
const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
const dbConfig = require('/db/db.config');
const pool = new Pool(dbConfig)

pool.on('error', (err, client) => {
    logger.info("errornt on an idle client: ", err);
    process.exit(1);
})

async function connect_to_database(){
    try{

        logger.info("connected to the database ", );

        const create_table_file_path = path.join(__dirname, '../migrations', 'create_tables.sql');

        const tables_to_create = await fs.readFile(create_table_file_path, 'utf-8');

        await pool.query(tables_to_create);

        logger.info("Tables created or already exist");

    }catch (error){
        logger.info("Error connecting to the database: ", error);
    }
}

module.exports = {
    pool, 
    connect_to_database,
    query: (text, params) => pool.query(text, params),
};
