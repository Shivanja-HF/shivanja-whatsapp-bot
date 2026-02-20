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
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      wa_id TEXT UNIQUE NOT NULL,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      wa_id TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'MAIN_MENU',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);

    CREATE TABLE IF NOT EXISTS leads (
      id BIGSERIAL PRIMARY KEY,
      wa_id TEXT NOT NULL,
      category TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
    CREATE INDEX IF NOT EXISTS idx_leads_wa_id ON leads(wa_id);
  `);

  console.log("Database initialized");
}

module.exports = {
  pool,
  testConnection,
  initDb,
  ensureUser,
  getSession,
  upsertSession,
  updateSession,
  createLead
};
