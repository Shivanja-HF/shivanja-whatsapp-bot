const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function testConnection() {
  const result = await pool.query("SELECT NOW()");
  return result.rows[0];
}

/* ----------- DIESE FUNKTIONEN MÜSSEN EXISTIEREN ----------- */

async function ensureUser(wa_id) {
  await pool.query(
    `INSERT INTO users (wa_id)
     VALUES ($1)
     ON CONFLICT (wa_id)
     DO UPDATE SET last_seen_at = now()`,
    [wa_id]
  );
}

async function getSession(wa_id) {
  const r = await pool.query(
    `SELECT * FROM sessions WHERE wa_id = $1`,
    [wa_id]
  );
  return r.rows[0] || null;
}

async function upsertSession(wa_id, state = "MAIN_MENU", data = {}) {
  const r = await pool.query(
    `INSERT INTO sessions (wa_id, state, data, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (wa_id)
     DO UPDATE SET state = EXCLUDED.state,
                   data = EXCLUDED.data,
                   updated_at = now()
     RETURNING *`,
    [wa_id, state, JSON.stringify(data)]
  );
  return r.rows[0];
}

async function createLead(wa_id, category, payload = {}) {
  const r = await pool.query(
    `INSERT INTO leads (wa_id, category, payload)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id`,
    [wa_id, category, JSON.stringify(payload)]
  );
  return r.rows[0];
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      wa_id TEXT UNIQUE NOT NULL,
      first_seen_at TIMESTAMPTZ DEFAULT now(),
      last_seen_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      wa_id TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'MAIN_MENU',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS leads (
      id BIGSERIAL PRIMARY KEY,
      wa_id TEXT NOT NULL,
      category TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  console.log("Database initialized");
}

/* ----------- EXPORT AM ENDE ----------- */

module.exports = {
  pool,
  testConnection,
  initDb,
  ensureUser,
  getSession,
  upsertSession,
  createLead
};
