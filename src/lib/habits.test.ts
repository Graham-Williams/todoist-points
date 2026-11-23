// Behaviour tests for habits, checks and the all-habits bonus, against a real
// throwaway SQLite DB (plus the routes' validation).
import "../test-support/hooks.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const h = await import("./habits.ts");
const q = await import("./queries.ts");
const { getDb } = await import("./db.ts");
const list = await import("../app/api/habits/route.ts");
const one = await import("../app/api/habits/[id]/route.ts");
const checks = await import("../app/api/habits/[id]/checks/[date]/route.ts");
const bonus = await import("../app/api/habits/bonus/route.ts");
const { utcDateStr, addDays } = await import("./dates.ts");

const D = "2026-11-20";
const db = () => getDb();

function ledgerRows() {
  return db().prepare(`SELECT id, type, points, source_id, description FROM ledger ORDER BY id`).all() as {
    id: number; type: string; points: number; source_id: string; description: string;
  }[];
}

// Habits created "in the past" so they are eligible for date D.
function habit(name: string, points: number, createdAt = "2026-11-01 12:00:00") {
  const created = h.createHabit(name, points);
  db().prepare(`UPDATE habits SET created_at = ? WHERE id = ?`).run(createdAt, created.id);
  return created.id;
}

beforeEach(() => {
  db().exec(
    `DELETE FROM habits; DELETE FROM habit_checks; DELETE FROM habit_bonus;
     DELETE FROM app_settings; DELETE FROM ledger; DELETE FROM balance_adjustments;
     DELETE FROM processed_completions; DELETE FROM pending_review; DELETE FROM list_order;`
  );
});

test("ticking a habit earns its points as a normal earn row; unticking removes it", () => {
  const a = habit("Stretch", 5);
  habit("Read", 7);
  const r = h.setHabitDone(a, D, true);
  assert.deepEqual(r, { found: true, done: true, bonus: false, newBalance: 5 });
  assert.deepEqual(
    ledgerRows().map(({ type, points, source_id, description }) => ({ type, points, source_id, description })),
    [{ type: "earn", points: 5, source_id: `habit:${a}:${D}`, description: "Habit: Stretch" }]
  );
  assert.equal(q.getStats().recentEarnings[0].title, "Habit: Stretch");
  // Idempotent mark.
  h.setHabitDone(a, D, true);
  assert.equal(ledgerRows().length, 1);
  // Unmark (twice — idempotent).
  assert.equal(h.setHabitDone(a, D, false).found && q.getBalance(), 0);
  h.setHabitDone(a, D, false);
  assert.equal(ledgerRows().length, 0);
  assert.equal((db().prepare(`SELECT COUNT(*) AS c FROM habit_checks`).get() as { c: number }).c, 0);
  // Sync bookkeeping is never touched.
  assert.equal((db().prepare(`SELECT COUNT(*) AS c FROM processed_completions`).get() as { c: number }).c, 0);
  assert.equal((db().prepare(`SELECT COUNT(*) AS c FROM pending_review`).get() as { c: number }).c, 0);
});

test("all eligible habits done -> bonus (default 10); unticking one revokes it", () => {
  const a = habit("Stretch", 5);
  const b = habit("Read", 7);
  h.setHabitDone(a, D, true);
  const r = h.setHabitDone(b, D, true);
  assert.equal(r.found && r.bonus, true);
  assert.equal(q.getBalance(), 5 + 7 + 10);
  const bonusRow = ledgerRows().find((l) => l.source_id === `habit-bonus:${D}`);
  assert.equal(bonusRow?.points, 10);
  assert.equal(bonusRow?.description, `All habits done (${D})`);
  assert.deepEqual(h.getHabitWeek(D, D).bonuses, [{ date: D, points: 10 }]);

  const r2 = h.setHabitDone(a, D, false);
  assert.equal(r2.found && r2.bonus, false);
  assert.equal(q.getBalance(), 7);
  assert.deepEqual(h.getHabitWeek(D, D).bonuses, []);
  // Bonus is per date: another day is independent.
  h.setHabitDone(a, "2026-11-21", true);
  assert.deepEqual(h.getHabitWeek(D, "2026-11-21").bonuses, []);
});

test("bonus value is captured when awarded; 0 means no bonus", () => {
  const a = habit("Stretch", 5);
  h.setBonusPoints(25);
  h.setHabitDone(a, D, true);
  assert.equal(q.getBalance(), 30);
  h.setBonusPoints(3); // later change does not rewrite history
  h.setHabitDone(a, D, true);
  assert.deepEqual(h.getHabitWeek(D, D).bonuses, [{ date: D, points: 25 }]);
  h.setBonusPoints(0);
  h.setHabitDone(a, "2026-11-21", true);
  assert.deepEqual(h.getHabitWeek("2026-11-21", "2026-11-21").bonuses, []);
  assert.equal(q.getBalance(), 35);
});

test("habits created after the date are not required for that date's bonus", () => {
  const a = habit("Stretch", 5);
  habit("New habit", 4, "2026-11-22 09:00:00");
  const r = h.setHabitDone(a, D, true);
  assert.equal(r.found && r.bonus, true);
  // ...but it is required from its creation date on.
  const r2 = h.setHabitDone(a, "2026-11-22", true);
  assert.equal(r2.found && r2.bonus, false);
});

test("archived habits: excluded from bonus eligibility and from toggles; history kept", () => {
  const a = habit("Stretch", 5);
  const b = habit("Read", 7);
  h.setHabitDone(b, D, true);
  assert.equal(h.archiveHabit(b), true);
  assert.equal(h.archiveHabit(b), false);
  assert.equal(q.getBalance(), 7); // archiving keeps past points
  assert.deepEqual(h.setHabitDone(b, D, false), { found: false });
  assert.deepEqual(h.getActiveHabits().map((x) => x.id), [a]);
  assert.deepEqual(h.getHabitWeek(D, D).checks, []);
  const r = h.setHabitDone(a, D, true);
  assert.equal(r.found && r.bonus, true);
});

test("unticking tolerates an earning already removed from the dashboard", () => {
  const a = habit("Stretch", 5);
  h.setHabitDone(a, D, true); // also earns the bonus (only habit)
  for (const row of ledgerRows()) q.deleteEarning(row.id);
  assert.equal(q.getBalance(), 0);
  const r = h.setHabitDone(a, D, false);
  assert.equal(r.found && r.newBalance, 0);
  assert.deepEqual(h.getHabitWeek(D, D), { habits: h.getActiveHabits(), checks: [], bonuses: [], bonusPoints: 10 });
});

test("habits follow the 'habits' drag order", () => {
  const a = habit("A", 1);
  const b = habit("B", 1);
  q.setOrder("habits", [String(b), String(a)]);
  assert.deepEqual(h.getActiveHabits().map((x) => x.name), ["B", "A"]);
});

// ---- routes ----------------------------------------------------------------

function json(method: string, body: unknown, url = "http://localhost/api/habits") {
  return new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
const ctx = (id: string, date: string) => ({ params: Promise.resolve({ id, date }) });

test("POST /api/habits validates name and points", async () => {
  for (const body of [
    { name: "", points: 5 }, { name: "   ", points: 5 }, { name: "x".repeat(101), points: 5 },
    { name: 5, points: 5 }, { name: "Ok", points: 0 }, { name: "Ok", points: 100001 },
    { name: "Ok", points: 1.5 }, { name: "Ok", points: null }, { name: "Ok" },
  ]) {
    assert.equal((await list.POST(json("POST", body))).status, 400, JSON.stringify(body));
  }
  assert.equal((await list.POST(json("POST", null))).status, 400);
  const res = await list.POST(json("POST", { name: "  Walk  ", points: 5 }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).habit.name, "Walk");
});

test("GET /api/habits validates the range (max 14 days, forward)", async () => {
  const get = (qs: string) => list.GET(new Request(`http://localhost/api/habits?${qs}`));
  assert.equal((await get("from=2026-11-17&to=2026-11-23")).status, 200);
  assert.equal((await get("from=2026-11-10&to=2026-11-23")).status, 200); // 14 days
  assert.equal((await get("from=2026-11-09&to=2026-11-23")).status, 400); // 15 days
  assert.equal((await get("from=2026-11-23&to=2026-11-17")).status, 400);
  assert.equal((await get("from=2026-02-30&to=2026-03-01")).status, 400);
  assert.equal((await get("to=2026-11-23")).status, 400);
});

test("check routes: id/date validation, window, 404, and success with balance", async () => {
  const today = utcDateStr(new Date());
  const a = habit("Stretch", 5, "2000-01-01 00:00:00");
  const ok = await checks.PUT(new Request("http://localhost"), ctx(String(a), today));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, done: true, bonus: true, newBalance: 15 });
  for (const [id, date, status] of [
    ["0", today, 400], ["1.5", today, 400], ["abc", today, 400],
    [String(a), "2026-13-01", 400], [String(a), addDays(today, 2), 400],
    [String(a), addDays(today, -61), 400], ["99999", today, 404],
  ] as const) {
    const res = await checks.PUT(new Request("http://localhost"), ctx(id, date));
    assert.equal(res.status, status, `${id} ${date}`);
  }
  assert.equal((await checks.PUT(new Request("http://localhost"), ctx(String(a), addDays(today, 1)))).status, 200);
  assert.equal((await checks.PUT(new Request("http://localhost"), ctx(String(a), addDays(today, -60)))).status, 200);
  const off = await checks.DELETE(new Request("http://localhost"), ctx(String(a), today));
  assert.equal((await off.json()).bonus, false);
  // Archived habit -> 404 on toggle; DELETE /api/habits/[id] 404s the second time.
  assert.equal((await one.DELETE(new Request("http://localhost"), { params: Promise.resolve({ id: String(a) }) })).status, 200);
  assert.equal((await one.DELETE(new Request("http://localhost"), { params: Promise.resolve({ id: String(a) }) })).status, 404);
  assert.equal((await checks.PUT(new Request("http://localhost"), ctx(String(a), today))).status, 404);
});

test("PUT /api/habits/bonus validates [0, 100000]", async () => {
  for (const bad of [-1, 100001, 2.5, "", null, true]) {
    assert.equal((await bonus.PUT(json("PUT", { points: bad }))).status, 400, String(bad));
  }
  assert.equal((await bonus.PUT(json("PUT", null))).status, 400);
  const res = await bonus.PUT(json("PUT", { points: 0 }));
  assert.deepEqual(await res.json(), { ok: true, bonusPoints: 0 });
  assert.equal(h.getBonusPoints(), 0);
});
