// Behaviour tests for creating, editing and deleting rewards (the lib and the
// /api/rewards routes), and for past redemptions surviving an edit, against a
// real throwaway SQLite DB.
import "../test-support/hooks.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const r = await import("./rewards.ts");
const q = await import("./queries.ts");
const { getDb } = await import("./db.ts");
const list = await import("../app/api/rewards/route.ts");
const one = await import("../app/api/rewards/[id]/route.ts");
const redeemRoute = await import("../app/api/rewards/[id]/redeem/route.ts");

const db = () => getDb();

function req(method: string, body: unknown, raw = false) {
  return new Request("http://localhost/api/rewards", {
    method,
    headers: { "Content-Type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}
const ctx = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });
const patch = (id: string | number, body: unknown, raw = false) =>
  one.PATCH(req("PATCH", body, raw), ctx(id));
const rewardRow = (id: number) =>
  db().prepare(`SELECT name, description, cost, active FROM rewards WHERE id = ?`).get(id);

beforeEach(() => {
  db().exec(`DELETE FROM rewards; DELETE FROM ledger; DELETE FROM balance_adjustments; DELETE FROM list_order;`);
});

test("POST /api/rewards creates a reward with an optional, trimmed description", async () => {
  const res = await list.POST(req("POST", { name: "  Movie night ", cost: 120, description: "  with popcorn " }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.id, body.reward.id);
  assert.deepEqual(rewardRow(body.id), {
    name: "Movie night", description: "with popcorn", cost: 120, active: 1,
  });
  const none = await (await list.POST(req("POST", { name: "Nap", cost: "15", description: "   " }))).json();
  assert.deepEqual(rewardRow(none.id), { name: "Nap", description: null, cost: 15, active: 1 });
});

test("POST /api/rewards rejects bad bodies, names, costs and descriptions", async () => {
  for (const bad of [
    null, [], "x", {}, { cost: 5 }, { name: "", cost: 5 }, { name: "   ", cost: 5 },
    { name: "x".repeat(101), cost: 5 }, { name: 7, cost: 5 },
    { name: "Ok" }, { name: "Ok", cost: 0 }, { name: "Ok", cost: -3 }, { name: "Ok", cost: 1.5 },
    { name: "Ok", cost: 100001 }, { name: "Ok", cost: "abc" }, { name: "Ok", cost: null },
    { name: "Ok", cost: true }, { name: "Ok", cost: 5, description: 5 },
    { name: "Ok", cost: 5, description: "x".repeat(501) },
  ]) {
    assert.equal((await list.POST(req("POST", bad))).status, 400, JSON.stringify(bad));
  }
  assert.equal((await list.POST(req("POST", "{not json", true))).status, 400);
  assert.equal(q.getRewards().length, 0);
});

test("GET /api/rewards returns description", async () => {
  r.createReward("Coffee", 30, "the fancy one");
  r.createReward("Nap", 15);
  const body = await (await list.GET()).json();
  assert.deepEqual(
    body.rewards.map((x: { name: string; description: string | null }) => [x.name, x.description]),
    [["Coffee", "the fancy one"], ["Nap", null]]
  );
});

test("PATCH /api/rewards/[id] edits name, description and cost (only the fields given)", async () => {
  const { id } = r.createReward("Coffee", 30, "the fancy one");
  let res = await patch(id, { name: "  Latte ", cost: 45 });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).reward.name, "Latte");
  assert.deepEqual(rewardRow(id), { name: "Latte", description: "the fancy one", cost: 45, active: 1 });
  res = await patch(id, { description: "  oat milk " });
  assert.deepEqual(rewardRow(id), { name: "Latte", description: "oat milk", cost: 45, active: 1 });
  // null and blank both clear the description.
  await patch(id, { description: null });
  assert.equal((rewardRow(id) as { description: string | null }).description, null);
  await patch(id, { description: "x" });
  await patch(id, { description: "  " });
  assert.equal((rewardRow(id) as { description: string | null }).description, null);
});

test("PATCH /api/rewards/[id] still toggles active, and inactive rewards are editable", async () => {
  const { id } = r.createReward("Coffee", 30);
  assert.equal((await patch(id, { active: false })).status, 200);
  assert.equal((rewardRow(id) as { active: number }).active, 0);
  assert.equal((await patch(id, { cost: 40 })).status, 200);
  assert.deepEqual(rewardRow(id), { name: "Coffee", description: null, cost: 40, active: 0 });
  await patch(id, { active: true });
  assert.equal((rewardRow(id) as { active: number }).active, 1);
});

test("PATCH /api/rewards/[id] validates id and body; 404s unknown ids; leaves the row alone", async () => {
  const { id } = r.createReward("Coffee", 30, "hot");
  const before = rewardRow(id);
  for (const bad of [
    {}, null, [], "x", 5, { name: "" }, { name: "   " }, { name: "x".repeat(101) }, { name: 3 },
    { cost: 0 }, { cost: -1 }, { cost: 1.5 }, { cost: "abc" }, { cost: null }, { cost: 100001 },
    { description: 3 }, { description: ["x"] }, { description: "x".repeat(501) },
    { active: "yes" }, { active: 1 }, { active: null },
    { name: "Fine", cost: 0 }, // one bad field rejects the whole edit
  ]) {
    assert.equal((await patch(id, bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await patch(id, "{not json", true)).status, 400);
  assert.equal((await patch(id, "", true)).status, 400);
  for (const badId of ["abc", "0", "-1", "1.5", "1e3", " 7", "07", `${id} `]) {
    assert.equal((await patch(badId, { cost: 3 })).status, 400, badId);
  }
  assert.deepEqual(rewardRow(id), before);
  assert.equal((await patch(id + 999, { cost: 3 })).status, 404);
});

test("DELETE /api/rewards/[id]: strict id, 404 when unknown, past redemptions stay", async () => {
  const { id } = r.createReward("Coffee", 5);
  db().prepare(`INSERT INTO ledger (type, points, description) VALUES ('earn', 20, 'x')`).run();
  await redeemRoute.POST(new Request("http://localhost/", { method: "POST" }), ctx(id));
  assert.equal((await one.DELETE(new Request("http://localhost/"), ctx("1.5"))).status, 400);
  assert.equal((await one.DELETE(new Request("http://localhost/"), ctx(id + 999))).status, 404);
  assert.equal((await one.DELETE(new Request("http://localhost/"), ctx(id))).status, 200);
  assert.equal(q.getRewards().length, 0);
  assert.equal(q.getBalance(), 15);
});

test("editing a reward never rewrites past redemptions; new ones use the new name and cost", async () => {
  const { id } = r.createReward("Coffee", 30);
  db().prepare(`INSERT INTO ledger (type, points, description) VALUES ('earn', 200, 'x')`).run();
  const redeem = () => redeemRoute.POST(new Request("http://localhost/", { method: "POST" }), ctx(id));
  assert.equal((await redeem()).status, 200);
  const redeems = () =>
    db().prepare(`SELECT points, source_id, description FROM ledger WHERE type = 'redeem' ORDER BY id`).all();
  const past = redeems();
  assert.deepEqual(past, [{ points: -30, source_id: String(id), description: "Redeemed: Coffee" }]);

  assert.equal((await patch(id, { name: "Latte", cost: 45, description: "oat milk" })).status, 200);
  assert.deepEqual(redeems(), past);
  assert.equal(q.getBalance(), 170);
  assert.deepEqual(
    q.getStats().history.map((h) => [h.description, h.points]),
    [["Redeemed: Coffee", -30]]
  );

  assert.equal((await redeem()).status, 200);
  assert.deepEqual(redeems(), [
    ...past,
    { points: -45, source_id: String(id), description: "Redeemed: Latte" },
  ]);
  assert.equal(q.getBalance(), 125);
});

test("createReward / updateReward validate their input (defense in depth)", () => {
  assert.throws(() => r.createReward("", 5), RangeError);
  assert.throws(() => r.createReward("Ok", 0), RangeError);
  assert.throws(() => r.createReward("Ok", 1.5), RangeError);
  assert.throws(() => r.createReward("Ok", 5, "x".repeat(501)), RangeError);
  const { id } = r.createReward("Ok", 5);
  assert.throws(() => r.updateReward(id, { name: " " }), RangeError);
  assert.throws(() => r.updateReward(id, { cost: 100001 }), RangeError);
  assert.equal(r.updateReward(id + 999, { cost: 3 }), null);
  assert.deepEqual(rewardRow(id), { name: "Ok", description: null, cost: 5, active: 1 });
});
