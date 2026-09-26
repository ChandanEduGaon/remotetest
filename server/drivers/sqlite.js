// Local-dev-only driver. Uses Node's built-in node:sqlite (Node 22.5+) so no
// native module install is required. The production driver is mysql.js --
// this exists purely so you can run/test this app on a machine without a
// MySQL server (e.g. `DB_CLIENT=sqlite npm run dev`).
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const appRoot = path.join(__dirname, '..', '..');
const relativePath = process.env.SQLITE_PATH || './data/dev.sqlite3';
const sqlitePath = path.isAbsolute(relativePath) ? relativePath : path.join(appRoot, relativePath);

fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });

const db = new DatabaseSync(sqlitePath);
db.exec('PRAGMA foreign_keys = ON;');

const SELECT_PATTERN = /^\s*(SELECT|PRAGMA)/i;

async function query(sql, params = []) {
  const stmt = db.prepare(sql);
  const result = SELECT_PATTERN.test(sql) ? stmt.all(...params) : stmt.run(...params);
  return [result];
}

async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sqlite.sql'), 'utf8');
  db.exec(sql);
  console.log(`[sqlite] dev database ready at ${sqlitePath}`);
}

async function upsertFormField(formId, field, value) {
  db.prepare(
    `INSERT INTO form_fields (form_id, field_name, field_value, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(form_id, field_name)
     DO UPDATE SET field_value = excluded.field_value, updated_at = CURRENT_TIMESTAMP`
  ).run(formId, field, value);
}

const pool = { query };

module.exports = { pool, initSchema, upsertFormField };
