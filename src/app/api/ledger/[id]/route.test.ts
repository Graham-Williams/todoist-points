// Behaviour tests for editing/removing a single earning or loss from the
// dashboard (PATCH / DELETE /api/ledger/[id]), on a real throwaway DB.
import "../../../../test-support/hooks.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { PATCH, DELETE } = await import("./route.ts");
const q = await import("../../../../lib/queries.ts");
const { getDb } = await import("../../../../lib/db.ts");

function row(type: "earn" | "redeem", points: number, description = "x"): number {
  return Number(
    getDb()
      .prepare(`INSERT INTO ledger (type, points, description) VALUES (?, ?, ?)`)
      .run(type, points, description).lastInsertRowid
  );
}
const pointsOf = (id: number) =>
  (getDb().prepare(`SELECT points FROM ledger WHERE id = ?`).get(id) as { points: number }).points;
const patch = (id: number | string, body: unknown) =>
  PATCH(
    new Request(`http://localhost/api/ledger/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );

beforeEach(() => {
  getDb().exec(`DELETE FROM ledger; DELETE FROM balance_adjustments;`);
});

test("editing a loss edits its magnitude and keeps it a loss", async () => {
  row("earn", 20);
  const loss = row("earn", -5, "Missed habit: Floss");
  const res = await patch(loss, { points: 8 });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, newBalance: 12 });
  assert.equal(pointsOf(loss), -8);
  // Editing it again (same magnitude) is stable.
  await patch(loss, { points: 8 });
  assert.equal(pointsOf(loss), -8);
});

test("editing a gain is unchanged: positive stays positive", async () => {
  const gain = row("earn", 5);
  const res = await patch(gain, { points: 9 });
  assert.deepEqual(await res.json(), { ok: true, newBalance: 9 });
  assert.equal(pointsOf(gain), 9);
});

test("PATCH validates the magnitude and never edits a redemption", async () => {
  const loss = row("earn", -5);
  for (const bad of [0, -8, 100001, 1.5, "abc", null]) {
    assert.equal((await patch(loss, { points: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal(pointsOf(loss), -5);
  const spend = row("redeem", -30);
  assert.equal((await patch(spend, { points: 8 })).status, 404);
  assert.equal(pointsOf(spend), -30);
});

test("dashboard: losses are listed, net earned subtracts them, balance identity holds", async () => {
  row("earn", 20, "Habit: Read");
  row("earn", -5, "Missed habit: Floss");
  row("redeem", -6, "Redeemed: Coffee");
  getDb().prepare(`INSERT INTO balance_adjustments (delta, note) VALUES (?, ?)`).run(4, "n");
  const s = q.getStats();
  assert.deepEqual(
    s.recentEarnings.map((e) => [e.title, e.points]),
    [["Missed habit: Floss", -5], ["Habit: Read", 20]]
  );
  assert.equal(s.netEarned, 15);
  assert.equal(s.totalSpent, 6);
  assert.equal(s.balance, s.netEarned - s.totalSpent + 4);
  // "Spending & adjustments" still lists only redemptions and adjustments.
  assert.deepEqual(s.history.map((h) => h.kind).sort(), ["adjust", "redeem"]);
});

test("removing a loss gives the points back", async () => {
  row("earn", 10);
  const loss = row("earn", -4);
  assert.equal(q.getBalance(), 6);
  const res = await DELETE(new Request("http://localhost"), { params: Promise.resolve({ id: String(loss) }) });
  assert.deepEqual(await res.json(), { ok: true, newBalance: 10 });
});
