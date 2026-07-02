import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// Single shared DB connection.
// Path is configurable via DB_PATH (absolute file path, e.g. /data/todoist-points.db
// inside the Docker container); defaults to ./data/todoist-points.db (gitignored).
let _db: Database.Database | null = null;

function resolveDbPath(): string {
  const envPath = process.env.DB_PATH;
  if (envPath && envPath.trim() !== "") {
    return path.resolve(envPath);
  }
  return path.join(process.cwd(), "data", "todoist-points.db");
}

function initSchema(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS label_points (
      label_name TEXT PRIMARY KEY,
      points     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ledger (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT NOT NULL CHECK (type IN ('earn', 'redeem')),
      points      INTEGER NOT NULL,
      source_id   TEXT,
      description TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rewards (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      cost       INTEGER NOT NULL,
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS processed_completions (
      completion_id TEXT PRIMARY KEY,
      processed_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS pending_review (
      completion_id TEXT PRIMARY KEY,
      content       TEXT NOT NULL,
      labels        TEXT,
      completed_at  TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function getDb(): Database.Database {
  if (_db) return _db;
  const dbPath = resolveDbPath();
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const db = new Database(dbPath);
  initSchema(db);
  _db = db;
  return db;
}
