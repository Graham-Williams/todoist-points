// Behaviour test for POST /api/review/discard-all on a real throwaway DB.
import "../../../../test-support/hooks.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { POST } = await import("./route.ts");
const { getDb } = await import("../../../../lib/db.ts");

const db = () => getDb();
const count = (sql: string) => (db().prepare(sql).get() as { c: number }).c;

function queue(id: string) {
  db().prepare(`INSERT INTO pending_review (completion_id, content) VALUES (?, ?)`).run(id, `Task ${id}`);
  db().prepare(`INSERT INTO processed_completions (completion_id) VALUES (?)`).run(id);
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/review/discard-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  db().exec(`DELETE FROM pending_review; DELETE FROM processed_completions; DELETE FROM ledger;`);
});

test("discards exactly the shown ids; they stay processed; no ledger rows", async () => {
  for (const id of ["c1", "c2", "c3"]) queue(id);
  const res = await post({ ids: ["c1", "c2", "c3"] });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, discarded: 3 });
  assert.equal(count(`SELECT COUNT(*) AS c FROM pending_review`), 0);
  assert.equal(count(`SELECT COUNT(*) AS c FROM processed_completions`), 3);
  assert.equal(count(`SELECT COUNT(*) AS c FROM ledger`), 0);
});

test("an item queued after the page loaded survives", async () => {
  queue("seen1");
  queue("seen2");
  const shown = ["seen1", "seen2"]; // what the page loaded
  queue("late"); // auto-sync queues another before Confirm
  const body = await (await post({ ids: shown })).json();
  assert.equal(body.discarded, 2);
  const left = db().prepare(`SELECT completion_id FROM pending_review`).all() as { completion_id: string }[];
  assert.deepEqual(left.map((r) => r.completion_id), ["late"]);
});

test("reports the count actually discarded (already-gone ids are skipped)", async () => {
  queue("a");
  const body = await (await post({ ids: ["a", "gone", "a"] })).json();
  assert.deepEqual(body, { ok: true, discarded: 1 });
});

test("invalid bodies are rejected with 400 and delete nothing", async () => {
  queue("keep");
  for (const bad of [
    {}, { ids: [] }, { ids: "keep" }, { ids: [1] }, { ids: [""] }, { ids: [null] },
    { ids: ["x".repeat(201)] }, { ids: Array.from({ length: 5001 }, (_, i) => `id${i}`) },
    "not json",
  ]) {
    const res = await post(bad);
    assert.equal(res.status, 400, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(count(`SELECT COUNT(*) AS c FROM pending_review`), 1);
  // Boundaries pass.
  assert.equal((await post({ ids: ["x".repeat(200)] })).status, 200);
  assert.equal((await post({ ids: Array.from({ length: 5000 }, (_, i) => `id${i}`) })).status, 200);
});
