const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const baseConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || ''
};
const dbName = process.env.DB_NAME || 'remotetest';

const pool = mysql.createPool({
  ...baseConfig,
  database: dbName,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true
});

async function ensureDatabase() {
  const conn = await mysql.createConnection(baseConfig);
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4`);
  } finally {
    await conn.end();
  }
}

async function initSchema() {
  await ensureDatabase();

  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.mysql.sql'), 'utf8');
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  const conn = await pool.getConnection();
  try {
    for (const statement of statements) {
      try {
        await conn.query(statement);
      } catch (err) {
        // Index already exists on a re-run - safe to ignore.
        if (err.code === 'ER_DUP_KEYNAME') continue;
        throw err;
      }
    }
  } finally {
    conn.release();
  }
}

async function upsertFormField(formId, field, value) {
  await pool.query(
    `INSERT INTO form_fields (form_id, field_name, field_value)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE field_value = VALUES(field_value)`,
    [formId, field, value]
  );
}

module.exports = { pool, initSchema, upsertFormField };
