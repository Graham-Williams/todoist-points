// Behaviour tests for balance overrides (POST /api/balance) and for every
// balance consumer routing through getBalance(), on a real throwaway DB.
import "../../../test-support/hooks.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { POST } = await import("./route.ts");
const { POST: REDEEM } = await import("../rewards/[id]/redeem/route.ts");
const { POST: AWARD } = await import("../review/[id]/award/route.ts");
const q = await import("../../../lib/queries.ts");
const { getDb } = await import("../../../lib/db.ts");

function post(body: unknown): Request {
  return new Request("http://localhost/api/balance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function earn(points: number) {
  getDb()
    .prepare(`INSERT INTO ledger (type, points, description) VALUES ('earn', ?, 'x')`)
    .run(points);
}

beforeEach(() => {
  getDb().exec(
    `DELETE FROM ledger; DELETE FROM balance_adjustments; DELETE FROM rewards; DELETE FROM pending_review;`
  );
});

test("setting the balance records the delta; lifetime totals are untouched", async () => {
  earn(100);
  earn(20);
  const res = await POST(post({ balance: 50 }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, newBalance: 50, delta: -70 });
  const stats = q.getStats();
  assert.equal(stats.balance, 50);
  assert.equal(stats.netEarned, 120);
  assert.equal(stats.totalSpent, 0);
  assert.equal(stats.history.length, 1);
  assert.equal(stats.history[0].kind, "adjust");
  assert.equal(stats.history[0].points, -70);
  assert.equal(stats.history[0].description, "Balance set to 50");
});

test("raising the balance and reset to 0 both work; earnings keep counting after", async () => {
  earn(10);
  await POST(post({ balance: 300 }));
  assert.equal(q.getBalance(), 300);
  await POST(post({ balance: 0 }));
  assert.equal(q.getBalance(), 0);
  earn(7);
  assert.equal(q.getBalance(), 7);
});

test("a zero delta inserts nothing", async () => {
  earn(40);
  const body = await (await POST(post({ balance: 40 }))).json();
  assert.deepEqual(body, { ok: true, newBalance: 40, delta: 0 });
  assert.equal(q.getStats().history.length, 0);
});

test("invalid targets are rejected with 400 and change nothing", async () => {
  earn(5);
  for (const bad of [-1, 1000001, 1.5, "abc", "", null, true, [], {}, undefined]) {
    const res = await POST(post({ balance: bad }));
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
  const res = await POST(new Request("http://localhost/api/balance", { method: "POST", body: "not json" }));
  assert.equal(res.status, 400);
  assert.equal((await POST(new Request("http://localhost/api/balance", { method: "POST", body: "null" }))).status, 400);
  assert.equal(q.getBalance(), 5);
  // Boundaries are accepted.
  assert.equal((await POST(post({ balance: 1000000 }))).status, 200);
  assert.equal((await POST(post({ balance: "12" }))).status, 200);
  assert.equal(q.getBalance(), 12);
});

test("redeem checks the adjusted balance", async () => {
  earn(100);
  await POST(post({ balance: 10 }));
  const id = getDb().prepare(`INSERT INTO rewards (name, cost) VALUES ('Treat', 30)`).run().lastInsertRowid;
  const params = { params: Promise.resolve({ id: String(id) }) };
  const denied = await REDEEM(new Request("http://localhost"), params);
  assert.equal(denied.status, 400);
  await POST(post({ balance: 30 }));
  const ok = await REDEEM(new Request("http://localhost"), params);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).newBalance, 0);
  const stats = q.getStats();
  assert.equal(stats.balance, 0);
  assert.equal(stats.totalSpent, 30);
  // History merges the redemption and both adjustments (-90, then +20).
  assert.equal(stats.history.length, 3);
  assert.ok(stats.history.some((h) => h.kind === "redeem" && h.points === -30));
  assert.deepEqual(
    stats.history.filter((h) => h.kind === "adjust").map((h) => h.points).sort((a, b) => a - b),
    [-90, 20]
  );
});

test("review award reports the adjusted balance", async () => {
  earn(100);
  await POST(post({ balance: 5 }));
  getDb().prepare(`INSERT INTO pending_review (completion_id, content) VALUES ('c1', 'Task')`).run();
  const res = await AWARD(
    new Request("http://localhost", { method: "POST", body: JSON.stringify({ points: 3 }) }),
    { params: Promise.resolve({ id: "c1" }) }
  );
  assert.equal((await res.json()).newBalance, 8);
});
