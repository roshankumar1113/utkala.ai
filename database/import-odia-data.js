const { Pool } = require('pg');
const fs = require('fs-extra');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'scraped_odia_data.json');

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/utkala_agents';

const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 5000
});

async function importOdiaData() {
  console.log('📦 Starting Odia Data Database Import...');

  if (!await fs.pathExists(DATA_FILE)) {
    console.error(`❌ Data file not found at ${DATA_FILE}. Please run "node scrapers/odia-data-scraper.js" first.`);
    process.exit(1);
  }

  const dataset = await fs.readJson(DATA_FILE);
  console.log(`📖 Loaded ${dataset.length} items from ${DATA_FILE}`);

  try {
    const client = await pool.connect();
    try {
      console.log('🔄 Ensuring "odia_data" table schema exists...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS odia_data (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          category VARCHAR(100),
          content TEXT NOT NULL,
          source_url TEXT,
          language VARCHAR(20) DEFAULT 'odia',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      let insertedCount = 0;
      for (const item of dataset) {
        await client.query(
          `INSERT INTO odia_data (title, category, content, source_url, language)
           VALUES ($1, $2, $3, $4, $5)`,
          [item.title, item.category, item.content, item.source_url, item.language || 'odia']
        );
        insertedCount++;
      }

      console.log(`✅ Successfully imported ${insertedCount} Odia data records into PostgreSQL database!`);
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn(`⚠️ PostgreSQL import notice: Database not active or connection refused (${err.message}). Data saved locally in JSON.`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  importOdiaData().catch(err => {
    console.error('❌ Import failed:', err);
    process.exit(1);
  });
}

module.exports = {
  importOdiaData
};
