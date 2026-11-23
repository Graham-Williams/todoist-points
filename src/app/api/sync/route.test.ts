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
// Raw JSON text for /activities pages (event ids are bare big integers, as the
// real API sends them). null = the activity log fails with a 500.
let activityPages: string[] | null = [];
let activityCalls: URL[] = [];
// When true, every /activities page points at the same next cursor.
let loopCursor = false;

function activityEvent(id: string, taskId: string, content: string, date: string, recurring: boolean | null) {
  const extra = recurring === null ? `{"content":${JSON.stringify(content)}}` :
    `{"content":${JSON.stringify(content)},"is_recurring":${recurring}}`;
  return `{"id":${id},"event_type":"completed","object_type":"item","object_id":"${taskId}","event_date":"${date}","extra_data":${extra}}`;
}

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith("/tasks/completed/by_completion_date")) {
    return new Response(JSON.stringify({ items, next_cursor: null }), { status: 200 });
  }
  assert.equal(url.pathname, "/api/v1/activities");
  activityCalls.push(url);
  if (activityPages === null) return new Response("boom", { status: 500 });
  if (loopCursor) return new Response(`{"results":[],"next_cursor":"same"}`, { status: 200 });
  const page = Number(url.searchParams.get("cursor") ?? "0");
  const next = page + 1 < activityPages.length ? `"${page + 1}"` : "null";
  return new Response(`{"results":[${activityPages[page] ?? ""}],"next_cursor":${next}}`, { status: 200 });
}) as typeof fetch;

function count(sql: string): number {
  return (getDb().prepare(sql).get() as { c: number }).c;
}

beforeEach(() => {
  items = [];
  activityPages = [];
  activityCalls = [];
  loopCursor = false;
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

// ---- recurring completions (activity log) ----------------------------------

const BIG1 = "1234567890123456789012345678901234561";
const BIG2 = "1234567890123456789012345678901234562"; // differs only past 2^53 precision

test("each completion of a recurring task is queued separately, keyed by exact event id", async () => {
  activityPages = [
    activityEvent(BIG2, "rt1", "Water plants", "2026-11-20T12:00:05.000000Z", true),
    activityEvent(BIG1, "rt1", "Water plants", "2026-11-20T12:00:00.000000Z", true),
  ];
  const body = await (await POST()).json();
  assert.equal(body.recurringQueued, 2);
  assert.equal(body.recurringOk, true);
  const rows = getDb()
    .prepare(`SELECT completion_id, content, labels, completed_at FROM pending_review ORDER BY completion_id`)
    .all();
  assert.deepEqual(rows, [
    { completion_id: `recurring:${BIG1}`, content: "Water plants", labels: "[]", completed_at: "2026-11-20T12:00:00.000000Z" },
    { completion_id: `recurring:${BIG2}`, content: "Water plants", labels: "[]", completed_at: "2026-11-20T12:00:05.000000Z" },
  ]);
  assert.equal(count(`SELECT COUNT(*) AS c FROM processed_completions WHERE completion_id LIKE 'recurring:%'`), 2);
  // The window is sent as explicit UTC.
  assert.match(activityCalls[0].searchParams.get("date_from")!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(activityCalls[0].searchParams.get("event_type"), "completed");
  assert.equal(activityCalls[0].searchParams.get("object_type"), "item");
});

test("recurring re-sync is idempotent, across pages", async () => {
  activityPages = [
    activityEvent(BIG1, "rt1", "Water plants", "2026-11-23T19:34:18Z", true),
    activityEvent(BIG2, "rt1", "Water plants", "2026-11-23T19:34:21Z", true),
  ];
  await POST();
  getDb().prepare(`DELETE FROM pending_review`).run(); // e.g. discarded
  const body = await (await POST()).json();
  assert.equal(body.recurringQueued, 0);
  assert.equal(count(`SELECT COUNT(*) AS c FROM pending_review`), 0);
});

test("non-recurring activity events are ignored (by_completion_date owns them)", async () => {
  items = [{ id: "n1", content: "One-off task", labels: [], completed_at: "2026-11-23T10:00:00Z" }];
  activityPages = [
    activityEvent("111", "n1", "One-off task", "2026-11-23T10:00:00Z", null) + "," +
      activityEvent("222", "n2", "Other one-off", "2026-11-23T11:00:00Z", false),
  ];
  const body = await (await POST()).json();
  assert.equal(body.newlyQueued, 1);
  assert.equal(body.recurringQueued, 0);
  assert.deepEqual(
    (getDb().prepare(`SELECT completion_id FROM pending_review`).all() as { completion_id: string }[]).map((r) => r.completion_id),
    ["n1"]
  );
});

test("recurring completions ignore task_point_overrides", async () => {
  getDb().prepare(`INSERT INTO task_point_overrides (task_id, points) VALUES ('rt1', 40)`).run();
  activityPages = [activityEvent(BIG1, "rt1", "Water plants", "2026-11-23T19:34:18Z", true)];
  await POST();
  assert.equal(count(`SELECT COUNT(*) AS c FROM ledger`), 0);
  assert.equal(count(`SELECT COUNT(*) AS c FROM pending_review`), 1);
  assert.equal(count(`SELECT COUNT(*) AS c FROM task_point_overrides`), 1);
});

test("an activity-log failure doesn't block normal completions or advance the recurring window", async () => {
  items = [{ id: "n1", content: "One-off task", labels: [], completed_at: "2026-11-23T10:00:00Z" }];
  activityPages = null;
  const res = await POST();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.newlyQueued, 1);
  assert.equal(body.recurringOk, false);
  const state = (key: string) =>
    (getDb().prepare(`SELECT value FROM sync_state WHERE key = ?`).get(key) as { value: string } | undefined)?.value;
  assert.ok(state("last_sync"));
  assert.equal(state("last_recurring_sync"), undefined);
  // Next run succeeds and picks the recurring completion up.
  activityPages = [activityEvent(BIG1, "rt1", "Water plants", "2026-11-23T19:34:18Z", true)];
  const body2 = await (await POST()).json();
  assert.equal(body2.recurringQueued, 1);
  assert.ok(state("last_recurring_sync"));
});

test("the recurring window resumes from last_recurring_sync minus the overlap, capped at 90 days", async () => {
  getDb().prepare(`INSERT INTO sync_state (key, value) VALUES ('last_recurring_sync', '2026-11-20T12:00:00.000Z')`).run();
  await POST();
  assert.equal(activityCalls[0].searchParams.get("date_from"), "2026-11-20T06:00:00Z");
  activityCalls = [];
  getDb().prepare(`UPDATE sync_state SET value = '2000-01-01T00:00:00.000Z' WHERE key = 'last_recurring_sync'`).run();
  await POST();
  const from = new Date(activityCalls[0].searchParams.get("date_from")!);
  const days = (Date.now() - from.getTime()) / 86400000;
  assert.ok(days > 89 && days < 91, String(days));
});

test("review award and discard work on a recurring: id via the routes (encoded)", async () => {
  activityPages = [
    activityEvent(BIG1, "rt1", "Water plants", "2026-11-23T19:34:18Z", true) + "," +
      activityEvent(BIG2, "rt1", "Water plants", "2026-11-23T19:34:21Z", true),
  ];
  await POST();
  const award = await import("../review/[id]/award/route.ts");
  const discard = await import("../review/[id]/discard/route.ts");
  const enc = (id: string) => ({ params: Promise.resolve({ id: encodeURIComponent(id) }) });
  const res = await award.POST(
    new Request("http://localhost", { method: "POST", body: JSON.stringify({ points: 4 }) }),
    enc(`recurring:${BIG1}`)
  );
  assert.equal(res.status, 200);
  assert.deepEqual(getDb().prepare(`SELECT type, points, source_id FROM ledger`).all(), [
    { type: "earn", points: 4, source_id: `recurring:${BIG1}` },
  ]);
  // Already-decoded ids work too.
  const res2 = await discard.POST(new Request("http://localhost", { method: "POST" }), {
    params: Promise.resolve({ id: `recurring:${BIG2}` }),
  });
  assert.equal(res2.status, 200);
  assert.equal(count(`SELECT COUNT(*) AS c FROM pending_review`), 0);
  // Both stay processed, so neither comes back.
  const body = await (await POST()).json();
  assert.equal(body.recurringQueued, 0);
});

test("a repeating /activities cursor fails the recurring fetch instead of looping", async () => {
  items = [{ id: "n1", content: "One-off task", labels: [], completed_at: "2026-11-23T10:00:00Z" }];
  loopCursor = true;
  const body = await (await POST()).json();
  assert.equal(body.newlyQueued, 1);
  assert.equal(body.recurringOk, false);
  assert.ok(activityCalls.length <= 3, `made ${activityCalls.length} calls`);
});
