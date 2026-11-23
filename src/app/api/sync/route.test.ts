// Behaviour test for POST /api/sync against a real throwaway SQLite DB, with
// Todoist's HTTP API stubbed via globalThis.fetch.
import "../../../test-support/hooks.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.TODOIST_API_TOKEN = "test-token";

const { POST } = await import("./route.ts");
const { getDb } = await import("../../../lib/db.ts");

type Item = { id: string; content: string; labels: string[]; completed_at: string };
let items: Item[] = [];

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  assert.ok(url.includes("/tasks/completed/by_completion_date"), url);
  return new Response(JSON.stringify({ items, next_cursor: null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

function count(sql: string): number {
  return (getDb().prepare(sql).get() as { c: number }).c;
}

beforeEach(() => {
  getDb().exec(
    `DELETE FROM ledger; DELETE FROM pending_review; DELETE FROM processed_completions;
     DELETE FROM sync_state; DELETE FROM label_points; DELETE FROM task_point_overrides;`
  );
});

test("every new completion is queued for review, whatever its labels", async () => {
  // Legacy config that USED to auto-award must now be ignored.
  getDb().prepare(`INSERT INTO label_points (label_name, points) VALUES ('chores', 10)`).run();
  getDb().prepare(`INSERT INTO task_point_overrides (task_id, points) VALUES ('t2', 50)`).run();
  items = [
    { id: "t1", content: "Labelled task", labels: ["chores"], completed_at: "2026-11-20T10:00:00Z" },
    { id: "t2", content: "Overridden task", labels: [], completed_at: "2026-11-20T11:00:00Z" },
    { id: "t3", content: "Plain task", labels: [], completed_at: "2026-11-20T12:00:00Z" },
  ];
  const res = await POST();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.newlyQueued, 3);
  assert.equal(body.pendingReview, 3);
  assert.equal(count(`SELECT COUNT(*) AS c FROM ledger`), 0);
  assert.equal(count(`SELECT COUNT(*) AS c FROM pending_review`), 3);
  assert.equal(count(`SELECT COUNT(*) AS c FROM processed_completions`), 3);
  // The legacy override row is not consumed.
  assert.equal(count(`SELECT COUNT(*) AS c FROM task_point_overrides`), 1);
});

test("re-sync is idempotent: processed completions are never re-queued", async () => {
  items = [{ id: "a", content: "Task A", labels: [], completed_at: "2026-11-20T10:00:00Z" }];
  await POST();
  // Discard it (as the Review tab would), then sync the same window again.
  getDb().prepare(`DELETE FROM pending_review WHERE completion_id = 'a'`).run();
  const body = await (await POST()).json();
  assert.equal(body.newlyQueued, 0);
  assert.equal(count(`SELECT COUNT(*) AS c FROM pending_review`), 0);
});
