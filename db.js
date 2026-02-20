const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function testConnection() {
  const result = await pool.query("SELECT NOW()");
  return result.rows[0];
}

module.exports = { pool, testConnection };
