// Migration test: a DB created by the first habits preview (before
// habits.description and habit_checks.status existed) gains the new columns on
// init, keeps its rows, and ends up with the same schema as a fresh DB.
import "../test-support/hooks.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

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
