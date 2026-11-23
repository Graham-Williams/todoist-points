// Behaviour test for POST /api/review/discard-all on a real throwaway DB.
import "../../../../test-support/hooks.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const { POST } = await import("./route.ts");
const { getDb } = await import("../../../../lib/db.ts");

test("discards every queued item, keeps them processed, and reports the count", async () => {
  const db = getDb();
  for (const id of ["c1", "c2", "c3"]) {
    db.prepare(`INSERT INTO pending_review (completion_id, content) VALUES (?, ?)`).run(id, `Task ${id}`);
    db.prepare(`INSERT INTO processed_completions (completion_id) VALUES (?)`).run(id);
  }
  const res = await POST();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, discarded: 3 });
  assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM pending_review`).get() as { c: number }).c, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM processed_completions`).get() as { c: number }).c, 3);
  assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM ledger`).get() as { c: number }).c, 0);
});

test("empty queue -> discarded: 0", async () => {
  const res = await POST();
  assert.deepEqual(await res.json(), { ok: true, discarded: 0 });
});
