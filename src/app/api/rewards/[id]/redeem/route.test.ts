// Behaviour tests for redeeming a reward (POST /api/rewards/[id]/redeem), incl.
// going below zero only when the request confirms it, on a real throwaway DB.
import "../../../../../test-support/hooks.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { POST } = await import("./route.ts");
const q = await import("../../../../../lib/queries.ts");
const { createReward, updateReward } = await import("../../../../../lib/rewards.ts");
const { getDb } = await import("../../../../../lib/db.ts");

const db = () => getDb();
const redeem = (id: number | string, body?: unknown, raw = false) =>
  POST(
    new Request(`http://localhost/api/rewards/${id}/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : raw ? (body as string) : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
const earn = (points: number) =>
  db().prepare(`INSERT INTO ledger (type, points, description) VALUES ('earn', ?, 'x')`).run(points);
const redeemRows = () =>
  db().prepare(`SELECT points, description FROM ledger WHERE type = 'redeem' ORDER BY id`).all();

beforeEach(() => {
  db().exec(`DELETE FROM rewards; DELETE FROM ledger; DELETE FROM balance_adjustments;`);
});

test("enough balance: redeems with no body, as before", async () => {
  const { id } = createReward("Coffee", 30);
  earn(50);
  const res = await redeem(id);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, newBalance: 20 });
  assert.deepEqual(redeemRows(), [{ points: -30, description: "Redeemed: Coffee" }]);
});

test("short balance without the flag: 400 insufficient_balance, nothing recorded", async () => {
  const { id } = createReward("Coffee", 30);
  earn(10);
  for (const body of [undefined, {}, { allowNegative: false }, "not json"]) {
    const res = await redeem(id, body, body === "not json");
    assert.equal(res.status, 400, JSON.stringify(body));
    const data = await res.json();
    assert.equal(data.code, "insufficient_balance");
    assert.equal(data.balance, 10);
    assert.equal(data.cost, 30);
  }
  assert.deepEqual(redeemRows(), []);
  assert.equal(q.getBalance(), 10);
});

test("allowNegative: true redeems below zero by exactly the cost", async () => {
  const { id } = createReward("Coffee", 30);
  earn(10);
  const res = await redeem(id, { allowNegative: true });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, newBalance: -20 });
  assert.equal(q.getBalance(), -20);
  assert.deepEqual(redeemRows(), [{ points: -30, description: "Redeemed: Coffee" }]);
});

test("an already-negative balance (incl. adjustments) can go further below zero", async () => {
  const { id } = createReward("Nap", 15);
  db().prepare(`INSERT INTO balance_adjustments (delta, note) VALUES (?, ?)`).run(-5, "n");
  assert.equal((await redeem(id)).status, 400);
  const res = await redeem(id, { allowNegative: true });
  assert.deepEqual(await res.json(), { ok: true, newBalance: -20 });
  assert.equal(q.getBalance(), -20);
});

test("a non-boolean allowNegative is a 400 and never redeems", async () => {
  const { id } = createReward("Coffee", 30);
  earn(100);
  for (const flag of ["true", 1, null, [], {}]) {
    const res = await redeem(id, { allowNegative: flag });
    assert.equal(res.status, 400, JSON.stringify(flag));
    assert.notEqual((await res.json()).code, "insufficient_balance");
  }
  assert.deepEqual(redeemRows(), []);
});

test("inactive rewards can't be redeemed even with the flag; bad and unknown ids", async () => {
  const { id } = createReward("Coffee", 30);
  earn(100);
  updateReward(id, { active: false });
  assert.equal((await redeem(id, { allowNegative: true })).status, 400);
  assert.equal((await redeem("1.5", { allowNegative: true })).status, 400);
  assert.equal((await redeem(id + 999, { allowNegative: true })).status, 404);
  assert.deepEqual(redeemRows(), []);
});
