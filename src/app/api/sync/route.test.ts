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

test("labels never score: a completion with no override is queued for review", async () => {
  // Legacy label config that USED to auto-award must be ignored.
  getDb().prepare(`INSERT INTO label_points (label_name, points) VALUES ('chores', 10)`).run();
  items = [
    { id: "t1", content: "Labelled task", labels: ["chores"], completed_at: "2026-11-20T10:00:00Z" },
    { id: "t3", content: "Plain task", labels: [], completed_at: "2026-11-20T12:00:00Z" },
  ];
  const res = await POST();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.newlyQueued, 2);
  assert.equal(body.preassignedAwarded, 0);
  assert.equal(body.pendingReview, 2);
  assert.equal(count(`SELECT COUNT(*) AS c FROM ledger`), 0);
  assert.equal(count(`SELECT COUNT(*) AS c FROM processed_completions`), 2);
});

test("a pre-assigned task is awarded exactly its points, not queued, and its override deleted", async () => {
  getDb().prepare(`INSERT INTO task_point_overrides (task_id, points, content) VALUES ('t2', 50, 'x')`).run();
  getDb().prepare(`INSERT INTO task_point_overrides (task_id, points, content) VALUES ('other', 9, 'y')`).run();
  items = [
    { id: "t2", content: "Book flights", labels: [], completed_at: "2026-11-20T11:00:00Z" },
    { id: "t4", content: "Plain task", labels: [], completed_at: "2026-11-20T12:00:00Z" },
  ];
  const body = await (await POST()).json();
  assert.equal(body.preassignedAwarded, 1);
  assert.equal(body.newlyQueued, 1);
  assert.deepEqual(
    getDb().prepare(`SELECT type, points, source_id, description FROM ledger`).all(),
    [{ type: "earn", points: 50, source_id: "t2", description: "Book flights (pre-assigned)" }]
  );
  assert.deepEqual(
    (getDb().prepare(`SELECT completion_id FROM pending_review`).all() as { completion_id: string }[]).map((r) => r.completion_id),
    ["t4"]
  );
  // Only the fired override is consumed.
  assert.deepEqual(
    (getDb().prepare(`SELECT task_id FROM task_point_overrides`).all() as { task_id: string }[]).map((r) => r.task_id),
    ["other"]
  );
  assert.equal(count(`SELECT COUNT(*) AS c FROM processed_completions`), 2);
  // Dashboard shows a clean title.
  const q = await import("../../../lib/queries.ts");
  assert.equal(q.getStats().recentEarnings[0].title, "Book flights");
});

test("re-sync is idempotent for both paths", async () => {
  getDb().prepare(`INSERT INTO task_point_overrides (task_id, points) VALUES ('p', 20)`).run();
  items = [
    { id: "a", content: "Task A", labels: [], completed_at: "2026-11-20T10:00:00Z" },
    { id: "p", content: "Task P", labels: [], completed_at: "2026-11-20T10:30:00Z" },
  ];
  await POST();
  // Discard A (as the Review tab would) and re-add an override for P, then
  // sync the same window again: nothing is re-queued or re-awarded.
  getDb().prepare(`DELETE FROM pending_review WHERE completion_id = 'a'`).run();
  getDb().prepare(`INSERT INTO task_point_overrides (task_id, points) VALUES ('p', 20)`).run();
  const body = await (await POST()).json();
  assert.equal(body.newlyQueued, 0);
  assert.equal(body.preassignedAwarded, 0);
  assert.equal(count(`SELECT COUNT(*) AS c FROM pending_review`), 0);
  assert.equal(count(`SELECT COUNT(*) AS c FROM ledger`), 1);
});
