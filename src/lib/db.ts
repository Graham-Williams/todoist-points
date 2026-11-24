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

// Exported for the migration test (src/lib/db.test.ts).
export function initSchema(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.exec(`
    -- LEGACY, unused since points moved to the Review tab. Kept (never dropped)
    -- so existing databases are untouched.
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

    -- Points set ahead of time for UPCOMING (uncompleted, dated) tasks, keyed
    -- by the ACTIVE Todoist task id, which equals the completed item's id on
    -- sync (verified 2026-07-08). Sync awards EXACTLY these points on
    -- completion (skipping the review queue) and deletes the row.
    CREATE TABLE IF NOT EXISTS task_point_overrides (
      task_id    TEXT PRIMARY KEY,
      points     INTEGER NOT NULL,
      content    TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Generic, per-list manual ordering. One row per (list, item) records the
    -- user's dragged position for that item within a named list. Valid list
    -- values: see ORDER_LISTS in queries.ts (old 'labels' rows may linger
    -- harmlessly). The
    -- GET paths left-join these positions so a reload reflects the custom order;
    -- items with no stored position keep their natural order and sort last.
    CREATE TABLE IF NOT EXISTS list_order (
      list      TEXT NOT NULL,
      item_key  TEXT NOT NULL,
      position  INTEGER NOT NULL,
      PRIMARY KEY (list, item_key)
    );

    -- Manual balance overrides ("set balance to N", "reset to 0"). Each row is
    -- the signed delta that moved the balance to the chosen value, so
    -- balance = SUM(ledger.points) + SUM(balance_adjustments.delta) — see
    -- getBalance() in queries.ts. Lifetime earned/spent stay ledger-only.
    CREATE TABLE IF NOT EXISTS balance_adjustments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      delta      INTEGER NOT NULL,
      note       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Daily habits (see src/lib/habits.ts). "Remove" sets archived_at (soft
    -- delete) so past checks and their ledger rows keep their history.
    -- description and penalty were added after the first preview shipped:
    -- older DBs get them from addColumnIfMissing below, so keep them LAST here,
    -- in the same order, to match. penalty: points lost when the habit is
    -- marked missed (NULL = no penalty).
    CREATE TABLE IF NOT EXISTS habits (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      points      INTEGER NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at TEXT,
      description TEXT,
      penalty     INTEGER
    );

    -- One row per habit marked on a client-local calendar date (YYYY-MM-DD).
    -- ledger_id is the 'earn' row the mark owns: for status 'done' the
    -- positive row it earned; for status 'missed' the NEGATIVE penalty row
    -- when the habit had a penalty, else NULL. The row may since have been
    -- removed from the dashboard; every transition tolerates that. status was
    -- added later (see addColumnIfMissing), so it stays LAST here.
    CREATE TABLE IF NOT EXISTS habit_checks (
      habit_id INTEGER NOT NULL,
      date     TEXT NOT NULL,
      ledger_id INTEGER,
      status   TEXT NOT NULL DEFAULT 'done',
      PRIMARY KEY (habit_id, date)
    );

    -- The "all habits done" bonus awarded for a date, and its ledger row.
    CREATE TABLE IF NOT EXISTS habit_bonus (
      date      TEXT PRIMARY KEY,
      ledger_id INTEGER
    );

    -- Small key/value settings (e.g. habit_bonus_points).
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Additive column migrations for tables that already exist on deployed DBs
  // (CREATE TABLE IF NOT EXISTS never alters an existing table). Idempotent:
  // each runs only when PRAGMA table_info lacks the column. Never rebuild a
  // table. A fresh DB already has these columns from the CREATE above.
  addColumnIfMissing(db, "habits", "description", "TEXT");
  addColumnIfMissing(db, "habit_checks", "status", "TEXT NOT NULL DEFAULT 'done'");
  addColumnIfMissing(db, "habits", "penalty", "INTEGER");
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
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
