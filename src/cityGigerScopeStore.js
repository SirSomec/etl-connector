const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_CITY_GIGER_SCOPE_STORE_PATH = path.join(process.cwd(), 'data', 'city-giger-scopes.sqlite');

function createCityGigerScopeStore({ filePath = DEFAULT_CITY_GIGER_SCOPE_STORE_PATH, now = () => new Date() } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);

  db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS city_giger_scopes (
  scope_key TEXT PRIMARY KEY,
  input_json TEXT NOT NULL,
  state TEXT NOT NULL,
  error_message TEXT NOT NULL DEFAULT '',
  refreshed_at TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS city_giger_scope_rows (
  scope_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  worker_id TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (scope_key, position)
);
CREATE INDEX IF NOT EXISTS idx_city_giger_scope_rows_lookup
  ON city_giger_scope_rows (scope_key, position);
`);

  function metadata(scopeKey) {
    const row = db.prepare(`
SELECT scope_key, input_json, state, error_message, refreshed_at, row_count
FROM city_giger_scopes
WHERE scope_key = ?
`).get(scopeKey);
    if (!row) return null;
    return {
      key: row.scope_key,
      input: JSON.parse(row.input_json),
      state: row.state,
      errorMessage: row.error_message,
      refreshedAt: row.refreshed_at,
      rowCount: Number(row.row_count || 0)
    };
  }

  function markLoading(scopeKey, input) {
    const timestamp = now().toISOString();
    db.prepare(`
INSERT INTO city_giger_scopes (scope_key, input_json, state, error_message, refreshed_at, row_count)
VALUES (?, ?, 'loading', '', ?, 0)
ON CONFLICT(scope_key) DO UPDATE SET
  input_json = excluded.input_json,
  state = 'loading',
  error_message = '',
  refreshed_at = excluded.refreshed_at
`).run(scopeKey, JSON.stringify(input), timestamp);
    return metadata(scopeKey);
  }

  function saveReady(scopeKey, input, rows) {
    const timestamp = now().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM city_giger_scope_rows WHERE scope_key = ?').run(scopeKey);
      const insert = db.prepare(`
INSERT INTO city_giger_scope_rows (scope_key, position, user_id, worker_id, full_name, phone, status)
VALUES (?, ?, ?, ?, ?, ?, ?)
`);
      rows.forEach((row, index) => insert.run(
        scopeKey,
        index,
        String(row.user_id || ''),
        String(row.worker_id || ''),
        String(row.full_name || ''),
        String(row.phone || ''),
        String(row.status || '')
      ));
      db.prepare(`
INSERT INTO city_giger_scopes (scope_key, input_json, state, error_message, refreshed_at, row_count)
VALUES (?, ?, 'ready', '', ?, ?)
ON CONFLICT(scope_key) DO UPDATE SET
  input_json = excluded.input_json,
  state = 'ready',
  error_message = '',
  refreshed_at = excluded.refreshed_at,
  row_count = excluded.row_count
`).run(scopeKey, JSON.stringify(input), timestamp, rows.length);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return metadata(scopeKey);
  }

  function saveFailure(scopeKey, input, errorMessage) {
    const timestamp = now().toISOString();
    db.prepare(`
INSERT INTO city_giger_scopes (scope_key, input_json, state, error_message, refreshed_at, row_count)
VALUES (?, ?, 'failed', ?, ?, 0)
ON CONFLICT(scope_key) DO UPDATE SET
  input_json = excluded.input_json,
  state = 'failed',
  error_message = excluded.error_message,
  refreshed_at = excluded.refreshed_at
`).run(scopeKey, JSON.stringify(input), String(errorMessage || ''), timestamp);
    return metadata(scopeKey);
  }

  function readPage(scopeKey, offset, limit) {
    const meta = metadata(scopeKey);
    if (!meta || meta.state !== 'ready') return { metadata: meta, rows: [] };
    return {
      metadata: meta,
      rows: db.prepare(`
SELECT user_id, worker_id, full_name, phone, status
FROM city_giger_scope_rows
WHERE scope_key = ?
ORDER BY position ASC
LIMIT ? OFFSET ?
`).all(scopeKey, limit, offset).map((row) => ({ ...row }))
    };
  }

  function listReadyInputs() {
    return db.prepare(`
SELECT scope_key, input_json
FROM city_giger_scopes
WHERE state = 'ready'
ORDER BY refreshed_at DESC
`).all().map((row) => ({ key: row.scope_key, input: JSON.parse(row.input_json) }));
  }

  function summarize(scopeKey) {
    const metadataRow = metadata(scopeKey);
    if (!metadataRow || metadataRow.state !== 'ready') return null;
    const row = db.prepare(`
SELECT
  COUNT(*) AS total,
  SUM(status IN ('ready', 'booked', 'worked')) AS ready_base,
  SUM(status = 'ready') AS ready,
  SUM(status = 'booked') AS booked,
  SUM(status = 'worked') AS worked
FROM city_giger_scope_rows
WHERE scope_key = ?
`).get(scopeKey);
    return {
      total: Number(row.total || 0),
      readyBase: Number(row.ready_base || 0),
      ready: Number(row.ready || 0),
      booked: Number(row.booked || 0),
      worked: Number(row.worked || 0)
    };
  }

  return { markLoading, saveReady, saveFailure, readPage, metadata, listReadyInputs, summarize, close: () => db.close() };
}

module.exports = { DEFAULT_CITY_GIGER_SCOPE_STORE_PATH, createCityGigerScopeStore };
