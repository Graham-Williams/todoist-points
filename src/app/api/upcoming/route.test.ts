// Behaviour tests for the Upcoming API (points set ahead of time for due-dated
// open tasks) on a real throwaway DB, with Todoist's /tasks stubbed.
import "../../../test-support/hooks.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.TODOIST_API_TOKEN = "test-token";

const { GET } = await import("./route.ts");
const one = await import("./[id]/route.ts");
const q = await import("../../../lib/queries.ts");
const { getDb } = await import("../../../lib/db.ts");

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  assert.equal(url.pathname, "/api/v1/tasks");
  const results = [
    { id: "a", content: "Dated A", labels: ["x"], due: { date: "2026-11-25", string: "Nov 25" } },
    { id: "b", content: "Undated B", labels: [], due: null },
    { id: "c", content: "Dated C", labels: [], due: { date: "2026-11-26", lang: "en", timezone: null, is_recurring: false } },
    { id: "r", content: "Recurring R", labels: [], due: { date: "2026-11-24", string: "every day", is_recurring: true } },
    { id: "done-before", content: "Reopened D", labels: [], due: { date: "2026-11-28", datetime: "2026-11-28T15:00:00" } },
  ];
  return new Response(JSON.stringify({ results, next_cursor: null }), { status: 200 });
}) as typeof fetch;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const put = (id: string, body: unknown) =>
  one.PUT(
    new Request("http://localhost", { method: "PUT", body: JSON.stringify(body) }),
    ctx(id)
  );

beforeEach(() => {
  getDb().exec(
    `DELETE FROM task_point_overrides; DELETE FROM list_order; DELETE FROM processed_completions;`
  );
});

test("GET lists only due-dated tasks, with saved points and no labels, in drag order", async () => {
  await put("c", { points: 15, content: "Dated C" });
  q.setOrder("upcoming", ["c", "a"]);
  const body = await (await GET()).json();
  assert.deepEqual(body.tasks, [
    { id: "c", content: "Dated C", due: { date: "2026-11-26", is_recurring: false }, points: 15 },
    { id: "a", content: "Dated A", due: { date: "2026-11-25", string: "Nov 25" }, points: null },
    {
      id: "done-before",
      content: "Reopened D",
      due: { date: "2026-11-28", datetime: "2026-11-28T15:00:00" },
      points: null,
    },
  ]);
});

test("an undated task with saved points is listed (due null); one without isn't", async () => {
  await put("b", { points: 30, content: "Undated B" });
  const tasks = (await (await GET()).json()).tasks as { id: string; due: unknown; points: number | null }[];
  assert.deepEqual(tasks.find((t) => t.id === "b"), { id: "b", content: "Undated B", due: null, points: 30 });
  await one.DELETE(new Request("http://localhost"), ctx("b"));
  const after = (await (await GET()).json()).tasks as { id: string }[];
  assert.equal(after.some((t) => t.id === "b"), false);
});

test("GET hides recurring tasks and tasks already processed by sync", async () => {
  getDb().prepare(`INSERT INTO processed_completions (completion_id) VALUES ('done-before')`).run();
  const ids = ((await (await GET()).json()).tasks as { id: string }[]).map((t) => t.id);
  assert.deepEqual(ids.sort(), ["a", "c"]);
});

test("PUT refuses (409) an id already in processed_completions, saving nothing", async () => {
  getDb().prepare(`INSERT INTO processed_completions (completion_id) VALUES ('done-before')`).run();
  const res = await put("done-before", { points: 5 });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /first time/);
  assert.equal(q.getTaskOverride("done-before"), undefined);
  assert.equal((await put("a", { points: 5 })).status, 200);
});

test("PUT upserts [1, 100000]; DELETE clears idempotently", async () => {
  assert.equal((await put("a", { points: 5 })).status, 200);
  assert.equal((await put("a", { points: "7" })).status, 200);
  assert.equal(q.getTaskOverride("a")?.points, 7);
  for (const bad of [0, -1, 100001, 1.5, "", null, true, "x"]) {
    assert.equal((await put("a", { points: bad })).status, 400, String(bad));
  }
  assert.equal(
    (await one.PUT(new Request("http://localhost", { method: "PUT", body: "null" }), ctx("a"))).status,
    400
  );
  assert.equal((await put("x".repeat(201), { points: 5 })).status, 400);
  assert.equal(q.getTaskOverride("a")?.points, 7);
  const del = await one.DELETE(new Request("http://localhost"), ctx("a"));
  assert.deepEqual(await del.json(), { ok: true, deleted: true });
  const again = await one.DELETE(new Request("http://localhost"), ctx("a"));
  assert.deepEqual(await again.json(), { ok: true, deleted: false });
});
