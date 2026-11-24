// Migration tests: a DB created by the first habits preview (before
// habits.description and habit_checks.status existed), by the release before
// habits.penalty, or by one before rewards.description, gains the new columns
// on init, keeps its rows, and ends up with the same schema as a fresh DB.
import "../test-support/hooks.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { getDb, initSchema } = await import("./db.ts");

function columns(db: Database.Database, table: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string; type: string; notnull: number; dflt_value: string | null; pk: number;
  }[]).map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, dflt_value, pk }));
}

test("old-shape habit tables migrate additively and match a fresh DB", () => {
  // Build the OLD shape at DB_PATH before the app opens it.
  const old = new Database(process.env.DB_PATH!);
  old.exec(`
    CREATE TABLE habits (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, points INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), archived_at TEXT);
    CREATE TABLE habit_checks (
      habit_id INTEGER NOT NULL, date TEXT NOT NULL, ledger_id INTEGER,
      PRIMARY KEY (habit_id, date));
    INSERT INTO habits (name, points) VALUES ('Stretch', 5);
    INSERT INTO habit_checks (habit_id, date, ledger_id) VALUES (1, '2026-11-20', 42);
  `);
  old.close();

  const db = getDb(); // runs initSchema (with migrations) on the old file
  initSchema(db); // and is idempotent on a second run

  const habit = db.prepare(`SELECT * FROM habits`).get() as Record<string, unknown>;
  assert.equal(habit.name, "Stretch");
  assert.equal(habit.points, 5);
  assert.equal(habit.description, null);
  assert.equal(habit.penalty, null);
  const check = db.prepare(`SELECT * FROM habit_checks`).get() as Record<string, unknown>;
  assert.deepEqual(
    { habit_id: check.habit_id, date: check.date, ledger_id: check.ledger_id, status: check.status },
    { habit_id: 1, date: "2026-11-20", ledger_id: 42, status: "done" }
  );

  const fresh = new Database(":memory:");
  initSchema(fresh);
  for (const table of ["habits", "habit_checks"]) {
    assert.deepEqual(columns(db, table), columns(fresh, table), table);
  }
});

test("a DB from before habits.penalty gains it (NULL = no penalty) and matches a fresh DB", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "todoist-points-mig-"));
  const old = new Database(path.join(dir, "old.db"));
  try {
    old.exec(`
      CREATE TABLE habits (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, points INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), archived_at TEXT, description TEXT);
      CREATE TABLE habit_checks (
        habit_id INTEGER NOT NULL, date TEXT NOT NULL, ledger_id INTEGER,
        status TEXT NOT NULL DEFAULT 'done', PRIMARY KEY (habit_id, date));
      INSERT INTO habits (name, points, description) VALUES ('Read', 7, 'evening');
      INSERT INTO habit_checks (habit_id, date, ledger_id, status) VALUES (1, '2026-11-20', NULL, 'missed');
    `);
    initSchema(old);
    initSchema(old);
    assert.deepEqual(
      old.prepare(`SELECT name, points, description, penalty FROM habits`).get(),
      { name: "Read", points: 7, description: "evening", penalty: null }
    );
    assert.deepEqual(
      old.prepare(`SELECT status, ledger_id FROM habit_checks`).get(),
      { status: "missed", ledger_id: null }
    );
    const fresh = new Database(":memory:");
    initSchema(fresh);
    for (const table of ["habits", "habit_checks"]) {
      assert.deepEqual(columns(old, table), columns(fresh, table), table);
    }
  } finally {
    old.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a DB from before rewards.description gains it (NULL) and keeps its rewards", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "todoist-points-mig-"));
  const old = new Database(path.join(dir, "old.db"));
  try {
    old.exec(`
      CREATE TABLE rewards (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, cost INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO rewards (name, cost, active) VALUES ('Movie night', 120, 0);
    `);
    initSchema(old);
    initSchema(old);
    assert.deepEqual(
      old.prepare(`SELECT name, cost, active, description FROM rewards`).get(),
      { name: "Movie night", cost: 120, active: 0, description: null }
    );
    const fresh = new Database(":memory:");
    initSchema(fresh);
    assert.deepEqual(columns(old, "rewards"), columns(fresh, "rewards"));
  } finally {
    old.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
