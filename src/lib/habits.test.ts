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
  const r = h.setHabitStatus(a, D, "done");
  assert.deepEqual(r, { found: true, status: "done", bonus: false, newBalance: 5 });
  assert.deepEqual(
    ledgerRows().map(({ type, points, source_id, description }) => ({ type, points, source_id, description })),
    [{ type: "earn", points: 5, source_id: `habit:${a}:${D}`, description: "Habit: Stretch" }]
  );
  assert.equal(q.getStats().recentEarnings[0].title, "Habit: Stretch");
  // Idempotent mark.
  h.setHabitStatus(a, D, "done");
  assert.equal(ledgerRows().length, 1);
  // Unmark (twice — idempotent).
  assert.equal(h.setHabitStatus(a, D, null).found && q.getBalance(), 0);
  h.setHabitStatus(a, D, null);
  assert.equal(ledgerRows().length, 0);
  assert.equal((db().prepare(`SELECT COUNT(*) AS c FROM habit_checks`).get() as { c: number }).c, 0);
  // Sync bookkeeping is never touched.
  assert.equal((db().prepare(`SELECT COUNT(*) AS c FROM processed_completions`).get() as { c: number }).c, 0);
  assert.equal((db().prepare(`SELECT COUNT(*) AS c FROM pending_review`).get() as { c: number }).c, 0);
});

test("all eligible habits done -> bonus (default 10); unticking one revokes it", () => {
  const a = habit("Stretch", 5);
  const b = habit("Read", 7);
  h.setHabitStatus(a, D, "done");
  const r = h.setHabitStatus(b, D, "done");
  assert.equal(r.found && r.bonus, true);
  assert.equal(q.getBalance(), 5 + 7 + 10);
  const bonusRow = ledgerRows().find((l) => l.source_id === `habit-bonus:${D}`);
  assert.equal(bonusRow?.points, 10);
  assert.equal(bonusRow?.description, `All habits done (${D})`);
  assert.deepEqual(h.getHabitWeek(D, D).bonuses, [{ date: D, points: 10 }]);

  const r2 = h.setHabitStatus(a, D, null);
  assert.equal(r2.found && r2.bonus, false);
  assert.equal(q.getBalance(), 7);
  assert.deepEqual(h.getHabitWeek(D, D).bonuses, []);
  // Bonus is per date: another day is independent.
  h.setHabitStatus(a, "2026-11-21", "done");
  assert.deepEqual(h.getHabitWeek(D, "2026-11-21").bonuses, []);
});

test("bonus value is captured when awarded; 0 means no bonus", () => {
  const a = habit("Stretch", 5);
  h.setBonusPoints(25);
  h.setHabitStatus(a, D, "done");
  assert.equal(q.getBalance(), 30);
  h.setBonusPoints(3); // later change does not rewrite history
  h.setHabitStatus(a, D, "done");
  assert.deepEqual(h.getHabitWeek(D, D).bonuses, [{ date: D, points: 25 }]);
  h.setBonusPoints(0);
  h.setHabitStatus(a, "2026-11-21", "done");
  assert.deepEqual(h.getHabitWeek("2026-11-21", "2026-11-21").bonuses, []);
  assert.equal(q.getBalance(), 35);
});

test("habits created after the date are not required for that date's bonus", () => {
  const a = habit("Stretch", 5);
  habit("New habit", 4, "2026-11-22 09:00:00");
  const r = h.setHabitStatus(a, D, "done");
  assert.equal(r.found && r.bonus, true);
  // ...but it is required from its creation date on.
  const r2 = h.setHabitStatus(a, "2026-11-22", "done");
  assert.equal(r2.found && r2.bonus, false);
});

test("archived habits: excluded from bonus eligibility and from toggles; history kept", () => {
  const a = habit("Stretch", 5);
  const b = habit("Read", 7);
  h.setHabitStatus(b, D, "done");
  assert.equal(h.archiveHabit(b), true);
  assert.equal(h.archiveHabit(b), false);
  assert.equal(q.getBalance(), 7); // archiving keeps past points
  assert.deepEqual(h.setHabitStatus(b, D, null), { found: false });
  assert.deepEqual(h.getActiveHabits().map((x) => x.id), [a]);
  assert.deepEqual(h.getHabitWeek(D, D).checks, []);
  const r = h.setHabitStatus(a, D, "done");
  assert.equal(r.found && r.bonus, true);
});

test("unticking tolerates an earning already removed from the dashboard", () => {
  const a = habit("Stretch", 5);
  h.setHabitStatus(a, D, "done"); // also earns the bonus (only habit)
  for (const row of ledgerRows()) q.deleteEarning(row.id);
  assert.equal(q.getBalance(), 0);
  const r = h.setHabitStatus(a, D, null);
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
  assert.deepEqual(await ok.json(), { ok: true, status: "done", done: true, bonus: true, newBalance: 15 });
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

// ---- three-state marks, descriptions, edits ---------------------------------

test("done -> missed -> clear: missed earns nothing and removes the earned row", () => {
  const a = habit("Stretch", 5);
  habit("Read", 7);
  h.setHabitStatus(a, D, "done");
  assert.equal(q.getBalance(), 5);
  const r = h.setHabitStatus(a, D, "missed");
  assert.deepEqual(r, { found: true, status: "missed", bonus: false, newBalance: 0 });
  assert.equal(ledgerRows().length, 0);
  assert.deepEqual(
    db().prepare(`SELECT status, ledger_id FROM habit_checks`).all(),
    [{ status: "missed", ledger_id: null }]
  );
  assert.deepEqual(h.getHabitWeek(D, D).checks, [{ habit_id: a, date: D, status: "missed", points: null }]);
  h.setHabitStatus(a, D, "missed"); // idempotent
  assert.equal(ledgerRows().length, 0);
  // missed -> done earns again.
  h.setHabitStatus(a, D, "done");
  assert.equal(q.getBalance(), 5);
  assert.equal(ledgerRows().length, 1);
  // Clear from missed leaves nothing.
  h.setHabitStatus(a, D, "missed");
  h.setHabitStatus(a, D, null);
  assert.equal((db().prepare(`SELECT COUNT(*) AS c FROM habit_checks`).get() as { c: number }).c, 0);
  assert.equal(q.getBalance(), 0);
  // Marking missed straight from blank creates a row with no ledger entry.
  h.setHabitStatus(a, "2026-11-21", "missed");
  assert.equal(ledgerRows().length, 0);
});

test("a missed habit blocks the bonus; switching it to done awards it", () => {
  const a = habit("Stretch", 5);
  const b = habit("Read", 7);
  h.setHabitStatus(a, D, "done");
  const r = h.setHabitStatus(b, D, "missed");
  assert.equal(r.found && r.bonus, false);
  assert.deepEqual(h.getHabitWeek(D, D).bonuses, []);
  const r2 = h.setHabitStatus(b, D, "done");
  assert.equal(r2.found && r2.bonus, true);
  assert.equal(q.getBalance(), 5 + 7 + 10);
  // done -> missed on one revokes it again.
  const r3 = h.setHabitStatus(a, D, "missed");
  assert.equal(r3.found && r3.bonus, false);
  assert.equal(q.getBalance(), 7);
});

test("descriptions are optional, trimmed, and blank becomes null", () => {
  assert.equal(h.createHabit("A", 1).description, null);
  assert.equal(h.createHabit("B", 1, "   ").description, null);
  assert.equal(h.createHabit("C", 1, "  before breakfast ").description, "before breakfast");
  assert.throws(() => h.createHabit("D", 1, "x".repeat(501)), RangeError);
});

test("editing a habit changes future ticks only", () => {
  const a = habit("Stretch", 5);
  h.setBonusPoints(0); // keep the ledger to habit rows only
  h.setHabitStatus(a, D, "done");
  const edited = h.updateHabit(a, { name: "Stretch well", points: 9, description: "10 min" });
  assert.equal(edited?.name, "Stretch well");
  assert.equal(edited?.points, 9);
  assert.equal(edited?.description, "10 min");
  // The row earned before the edit keeps its value and description.
  assert.deepEqual(ledgerRows().map((l) => [l.points, l.description]), [[5, "Habit: Stretch"]]);
  h.setHabitStatus(a, "2026-11-21", "done");
  assert.deepEqual(ledgerRows().map((l) => [l.points, l.description]), [
    [5, "Habit: Stretch"],
    [9, "Habit: Stretch well"],
  ]);
  // Partial edit leaves other fields; description null clears it.
  assert.equal(h.updateHabit(a, { description: null })?.description, null);
  assert.equal(h.updateHabit(a, { description: null })?.name, "Stretch well");
  // Unknown or archived -> null.
  assert.equal(h.updateHabit(99999, { points: 3 }), null);
  h.archiveHabit(a);
  assert.equal(h.updateHabit(a, { points: 3 }), null);
});

test("PUT check body: absent/empty/{} = done, status missed, anything else 400", async () => {
  const today = utcDateStr(new Date());
  const a = habit("Stretch", 5, "2000-01-01 00:00:00");
  const put = (body?: string) =>
    checks.PUT(new Request("http://localhost", { method: "PUT", body }), ctx(String(a), today));
  const status = async (res: Response) => (await res.json()).status;
  assert.equal(await status(await put()), "done");
  assert.equal(await status(await put("")), "done");
  assert.equal(await status(await put("{}")), "done");
  assert.equal(await status(await put(JSON.stringify({ status: "missed" }))), "missed");
  assert.equal(await status(await put(JSON.stringify({ status: "done" }))), "done");
  for (const bad of ['{"status":"skipped"}', '{"status":null}', '{"status":1}', "null", "[]", '"done"', "not json"]) {
    assert.equal((await put(bad)).status, 400, bad);
  }
  // DELETE clears a missed mark too.
  await put(JSON.stringify({ status: "missed" }));
  const del = await checks.DELETE(new Request("http://localhost"), ctx(String(a), today));
  assert.equal(await status(del), null);
  assert.equal((db().prepare(`SELECT COUNT(*) AS c FROM habit_checks`).get() as { c: number }).c, 0);
});

test("POST /api/habits accepts an optional description", async () => {
  const ok = await list.POST(json("POST", { name: "Walk", points: 5, description: "  after lunch " }));
  assert.equal((await ok.json()).habit.description, "after lunch");
  const none = await list.POST(json("POST", { name: "Run", points: 5 }));
  assert.equal((await none.json()).habit.description, null);
  for (const bad of [{ description: "x".repeat(501) }, { description: 5 }, { description: ["x"] }]) {
    assert.equal((await list.POST(json("POST", { name: "Ok", points: 5, ...bad }))).status, 400);
  }
});

test("PATCH /api/habits/[id] validates like create and 404s unknown/archived", async () => {
  const a = habit("Stretch", 5);
  const patch = (id: string, body: unknown) =>
    one.PATCH(json("PATCH", body), { params: Promise.resolve({ id }) });
  const res = await patch(String(a), { points: 8, description: "slow" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.habit.points, 8);
  assert.equal(body.habit.name, "Stretch");
  for (const bad of [
    {}, null, [], { name: "" }, { name: "x".repeat(101) }, { points: 0 }, { points: "abc" },
    { description: "x".repeat(501) }, { description: 3 },
  ]) {
    assert.equal((await patch(String(a), bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await patch("abc", { points: 3 })).status, 400);
  assert.equal((await patch("99999", { points: 3 })).status, 404);
  h.archiveHabit(a);
  assert.equal((await patch(String(a), { points: 3 })).status, 404);
});

// ---- penalties (losing points for a missed habit) ---------------------------

// A habit with a penalty, created "in the past" so it is eligible for D.
function penaltyHabit(name: string, points: number, penalty: number) {
  const id = habit(name, points);
  h.updateHabit(id, { penalty });
  return id;
}
const checkRow = (id: number, date = D) =>
  db().prepare(`SELECT status, ledger_id FROM habit_checks WHERE habit_id = ? AND date = ?`).get(id, date) as
    | { status: string; ledger_id: number | null }
    | undefined;

test("penalised habit: every transition leaves exactly the new status's value", () => {
  h.setBonusPoints(0); // isolate the habit's own rows
  const a = penaltyHabit("Floss", 5, 3);
  const rows = () => ledgerRows().map(({ points, source_id, description }) => ({ points, source_id, description }));
  const done = { points: 5, source_id: `habit:${a}:${D}`, description: "Habit: Floss" };
  const miss = { points: -3, source_id: `habit-miss:${a}:${D}`, description: "Missed habit: Floss" };

  // blank -> missed: loses the penalty; the check owns the negative row.
  let r = h.setHabitStatus(a, D, "missed");
  assert.deepEqual(r, { found: true, status: "missed", bonus: false, newBalance: -3 });
  assert.deepEqual(rows(), [miss]);
  assert.equal(checkRow(a)?.ledger_id, ledgerRows()[0].id);
  // missed -> missed: no-op.
  h.setHabitStatus(a, D, "missed");
  assert.deepEqual(rows(), [miss]);
  // missed -> done: the penalty row goes, the earn row comes.
  r = h.setHabitStatus(a, D, "done");
  assert.equal(r.found && r.newBalance, 5);
  assert.deepEqual(rows(), [done]);
  // done -> done: no-op.
  h.setHabitStatus(a, D, "done");
  assert.deepEqual(rows(), [done]);
  // done -> missed.
  r = h.setHabitStatus(a, D, "missed");
  assert.equal(r.found && r.newBalance, -3);
  assert.deepEqual(rows(), [miss]);
  assert.deepEqual(h.getHabitWeek(D, D).checks, [{ habit_id: a, date: D, status: "missed", points: -3 }]);
  // missed -> blank.
  r = h.setHabitStatus(a, D, null);
  assert.equal(r.found && r.newBalance, 0);
  assert.deepEqual(rows(), []);
  assert.equal(checkRow(a), undefined);
  // blank -> done -> blank.
  h.setHabitStatus(a, D, "done");
  r = h.setHabitStatus(a, D, null);
  assert.equal(r.found && r.newBalance, 0);
  assert.deepEqual(rows(), []);
});

test("cycling cells many times always leaves the balance at the marks' total", () => {
  h.setBonusPoints(0);
  const a = penaltyHabit("Floss", 5, 3);
  const b = habit("Read", 7); // no penalty
  const c = penaltyHabit("Run", 4, 9);
  const value: Record<string, Record<string, number>> = {
    [a]: { done: 5, missed: -3 }, [b]: { done: 7, missed: 0 }, [c]: { done: 4, missed: -9 },
  };
  const dates = [D, "2026-11-21", "2026-11-22"];
  type Mark = "done" | "missed" | null;
  const states: Mark[] = ["done", "missed", null];
  const current = new Map<string, Mark>();
  let seed = 12345; // deterministic LCG
  const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
  for (let i = 0; i < 600; i++) {
    const id = [a, b, c][rand(3)];
    const date = dates[rand(3)];
    // Mostly follow the UI's tap cycle, sometimes jump (or repeat) like a retry.
    const prev = current.get(`${id}|${date}`) ?? null;
    const next: Mark = rand(4) === 0 ? states[rand(3)] : prev === null ? "done" : prev === "done" ? "missed" : null;
    h.setHabitStatus(id, date, next);
    current.set(`${id}|${date}`, next);
    let expected = 0;
    let expectedRows = 0;
    for (const [k, s] of current) {
      if (s === null) continue;
      const v = value[k.split("|")[0]][s];
      expected += v;
      if (v !== 0) expectedRows += 1;
    }
    assert.equal(q.getBalance(), expected, `tap ${i}`);
    assert.equal(ledgerRows().length, expectedRows, `rows after tap ${i}`);
  }
});

test("a habit without a penalty: missed creates no ledger row", () => {
  h.setBonusPoints(0);
  const a = habit("Read", 7);
  assert.equal(h.getActiveHabits()[0].penalty, null);
  h.setHabitStatus(a, D, "missed");
  assert.deepEqual(ledgerRows(), []);
  assert.equal(checkRow(a)?.ledger_id, null);
  // Clearing the penalty (0 or null) turns it back into a free miss.
  h.updateHabit(a, { penalty: 4 });
  h.updateHabit(a, { penalty: 0 });
  assert.equal(h.getActiveHabits()[0].penalty, null);
  h.setHabitStatus(a, "2026-11-21", "missed");
  assert.deepEqual(ledgerRows(), []);
});

test("editing the penalty affects future misses only", () => {
  h.setBonusPoints(0);
  const a = penaltyHabit("Floss", 5, 3);
  h.setHabitStatus(a, D, "missed");
  h.updateHabit(a, { penalty: 10 });
  h.setHabitStatus(a, D, "missed"); // same status: keeps the captured -3
  assert.deepEqual(ledgerRows().map((l) => l.points), [-3]);
  h.setHabitStatus(a, "2026-11-21", "missed");
  assert.deepEqual(ledgerRows().map((l) => l.points), [-3, -10]);
  // Updating other fields leaves the penalty alone.
  assert.equal(h.updateHabit(a, { points: 6 })?.penalty, 10);
  // Removing the penalty leaves already-lost rows in place.
  h.updateHabit(a, { penalty: null });
  assert.deepEqual(ledgerRows().map((l) => l.points), [-3, -10]);
  assert.equal(q.getBalance(), -13);
});

test("a penalty row removed from the dashboard: clearing and re-marking still net correctly", () => {
  h.setBonusPoints(0);
  const a = penaltyHabit("Floss", 5, 3);
  h.setHabitStatus(a, D, "missed");
  q.deleteEarning(ledgerRows()[0].id);
  assert.equal(q.getBalance(), 0);
  // missed -> done after the removal: just the earn row.
  let r = h.setHabitStatus(a, D, "done");
  assert.equal(r.found && r.newBalance, 5);
  // And straight to clear after another removal.
  h.setHabitStatus(a, D, "missed");
  q.deleteEarning(ledgerRows()[0].id);
  r = h.setHabitStatus(a, D, null);
  assert.equal(r.found && r.newBalance, 0);
  assert.deepEqual(ledgerRows(), []);
  assert.equal(checkRow(a), undefined);
});

test("penalties can take the balance below zero", () => {
  h.setBonusPoints(0);
  const a = penaltyHabit("Floss", 5, 20);
  h.setHabitStatus(a, "2026-11-19", "done");
  const r = h.setHabitStatus(a, D, "missed");
  assert.equal(r.found && r.newBalance, -15);
  assert.equal(q.getStats().balance, -15);
});

test("a penalised miss blocks the bonus like any miss", () => {
  const a = penaltyHabit("Floss", 5, 3);
  const b = habit("Read", 7);
  h.setHabitStatus(b, D, "done");
  const r = h.setHabitStatus(a, D, "missed");
  assert.equal(r.found && r.bonus, false);
  assert.equal(q.getBalance(), 7 - 3);
  const r2 = h.setHabitStatus(a, D, "done");
  assert.equal(r2.found && r2.bonus, true);
  assert.equal(q.getBalance(), 5 + 7 + 10);
});

test("createHabit / updateHabit validate the penalty", () => {
  assert.equal(h.createHabit("A", 5).penalty, null);
  assert.equal(h.createHabit("B", 5, null, 0).penalty, null);
  assert.equal(h.createHabit("C", 5, null, 8).penalty, 8);
  for (const bad of [-1, 1.5, 100001, NaN]) {
    assert.throws(() => h.createHabit("D", 5, null, bad), RangeError, String(bad));
  }
  const id = h.createHabit("E", 5, null, 2).id;
  assert.throws(() => h.updateHabit(id, { penalty: -2 }), RangeError);
  assert.equal(h.updateHabit(id, { name: "E2" })?.penalty, 2);
  assert.equal(h.updateHabit(id, { penalty: null })?.penalty, null);
});

test("POST/PATCH /api/habits accept a penalty (null/0 = none) and GET returns it", async () => {
  const created = await list.POST(json("POST", { name: "Floss", points: 5, penalty: 5 }));
  assert.equal(created.status, 200);
  const id = (await created.json()).habit.id as number;
  for (const penalty of [undefined, null, 0]) {
    const res = await list.POST(json("POST", { name: "Read", points: 5, penalty }));
    assert.equal((await res.json()).habit.penalty, null, String(penalty));
  }
  for (const bad of [-1, 1.5, 100001, "", "abc", true, [3], {}]) {
    assert.equal(
      (await list.POST(json("POST", { name: "Ok", points: 5, penalty: bad }))).status, 400, JSON.stringify(bad)
    );
  }
  const patch = (body: unknown) => one.PATCH(json("PATCH", body), { params: Promise.resolve({ id: String(id) }) });
  // Penalty alone is a valid edit; other edits leave it unchanged.
  assert.equal((await (await patch({ penalty: 8 })).json()).habit.penalty, 8);
  assert.equal((await (await patch({ points: 6 })).json()).habit.penalty, 8);
  for (const bad of [-3, 2.5, 100001, "x"]) {
    assert.equal((await patch({ penalty: bad })).status, 400, JSON.stringify(bad));
  }
  const res = await list.GET(new Request(`http://localhost/api/habits?from=${D}&to=${D}`));
  const floss = (await res.json()).habits.find((x: { id: number }) => x.id === id);
  assert.equal(floss.penalty, 8);
  assert.equal((await (await patch({ penalty: null })).json()).habit.penalty, null);
  assert.equal((await (await patch({ penalty: 4 })).json()).habit.penalty, 4);
  assert.equal((await (await patch({ penalty: 0 })).json()).habit.penalty, null);
});

test("marking a penalised habit missed over HTTP returns the lowered balance", async () => {
  h.setBonusPoints(0);
  const today = utcDateStr(new Date());
  const a = habit("Floss", 5, "2000-01-01 00:00:00");
  h.updateHabit(a, { penalty: 4 });
  const put = (body: string) =>
    checks.PUT(new Request("http://localhost", { method: "PUT", body }), ctx(String(a), today));
  assert.equal((await (await put('{"status":"missed"}')).json()).newBalance, -4);
  assert.equal((await (await put('{"status":"done"}')).json()).newBalance, 5);
  assert.equal((await (await put('{"status":"missed"}')).json()).newBalance, -4);
  const del = await checks.DELETE(new Request("http://localhost"), ctx(String(a), today));
  assert.equal((await del.json()).newBalance, 0);
});
