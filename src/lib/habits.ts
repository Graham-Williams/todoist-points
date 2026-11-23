// Daily habits: mark a habit done for a date to earn its points (or mark it
// missed, which earns nothing); mark every habit done for a date to also earn
// the all-habits bonus.
//
// Dates are client-local `YYYY-MM-DD` strings (validated by the routes, see
// src/lib/dates.ts). Habit and bonus points are ordinary 'earn' ledger rows
// (source_id `habit:<id>:<date>` / `habit-bonus:<date>`), so they show in Recent
// earnings and count toward the balance. They never touch processed_completions
// or pending_review, which belong to Todoist sync.
import { getDb } from "./db";
import { applyOrder, getBalance, getOrderMap } from "./queries";
import { DESCRIPTION_MAX, HABIT_NAME_MAX, HABIT_POINTS_MAX } from "./validate";

export { HABIT_NAME_MAX, HABIT_POINTS_MAX };

export const BONUS_POINTS_MAX = 100000;
export const DEFAULT_BONUS_POINTS = 10;
const BONUS_KEY = "habit_bonus_points";

export type CheckStatus = "done" | "missed";

export interface Habit {
  id: number;
  name: string;
  description: string | null;
  points: number;
  created_at: string;
}

const HABIT_COLS = `id, name, description, points, created_at`;

export interface HabitWeek {
  habits: Habit[];
  checks: { habit_id: number; date: string; status: CheckStatus }[];
  // Bonus earned per date; points is null if its ledger row was later removed.
  bonuses: { date: string; points: number | null }[];
  bonusPoints: number;
}

export function getBonusPoints(): number {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(BONUS_KEY) as { value: string } | undefined;
  const n = row ? Number(row.value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_BONUS_POINTS;
}

// Changing the bonus only affects bonuses awarded from now on; past bonus
// ledger rows keep the value captured when they were awarded.
export function setBonusPoints(points: number): { ok: true; bonusPoints: number } {
  if (!Number.isInteger(points) || points < 0 || points > BONUS_POINTS_MAX) {
    throw new RangeError(`Bonus must be an integer between 0 and ${BONUS_POINTS_MAX}`);
  }
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(BONUS_KEY, String(points));
  return { ok: true, bonusPoints: points };
}

// Active (not archived) habits in the user's drag order.
export function getActiveHabits(): Habit[] {
  const rows = getDb()
    .prepare(
      `SELECT ${HABIT_COLS} FROM habits
       WHERE archived_at IS NULL ORDER BY id ASC`
    )
    .all() as Habit[];
  return applyOrder(rows, (h) => String(h.id), getOrderMap("habits"));
}

function checkName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > HABIT_NAME_MAX) {
    throw new RangeError(`Name must be 1–${HABIT_NAME_MAX} characters`);
  }
  return trimmed;
}

function checkPoints(points: number): number {
  if (!Number.isInteger(points) || points < 1 || points > HABIT_POINTS_MAX) {
    throw new RangeError(`Points must be an integer between 1 and ${HABIT_POINTS_MAX}`);
  }
  return points;
}

// Trimmed; blank -> NULL. (Routes validate with parseDescription first.)
function checkDescription(description: string | null | undefined): string | null {
  const trimmed = (description ?? "").trim();
  if (trimmed.length > DESCRIPTION_MAX) {
    throw new RangeError(`Description must be at most ${DESCRIPTION_MAX} characters`);
  }
  return trimmed === "" ? null : trimmed;
}

function getHabit(id: number): Habit {
  return getDb()
    .prepare(`SELECT ${HABIT_COLS} FROM habits WHERE id = ?`)
    .get(id) as Habit;
}

export function createHabit(
  name: string,
  points: number,
  description: string | null = null
): Habit {
  const values = [checkName(name), checkDescription(description), checkPoints(points)];
  const id = Number(
    getDb()
      .prepare(`INSERT INTO habits (name, description, points) VALUES (?, ?, ?)`)
      .run(...values).lastInsertRowid
  );
  return getHabit(id);
}

export interface HabitUpdate {
  name?: string;
  description?: string | null;
  points?: number;
}

// Edit an active habit's name / description / points (only the fields given).
// Points changes apply to FUTURE ticks only: ledger rows already earned keep
// their value. Returns null if there is no such active habit.
export function updateHabit(id: number, update: HabitUpdate): Habit | null {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (update.name !== undefined) {
    sets.push("name = ?");
    values.push(checkName(update.name));
  }
  if (update.description !== undefined) {
    sets.push("description = ?");
    values.push(checkDescription(update.description));
  }
  if (update.points !== undefined) {
    sets.push("points = ?");
    values.push(checkPoints(update.points));
  }
  const db = getDb();
  const exists = db
    .prepare(`SELECT 1 FROM habits WHERE id = ? AND archived_at IS NULL`)
    .get(id);
  if (!exists) return null;
  if (sets.length > 0) {
    db.prepare(`UPDATE habits SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  }
  return getHabit(id);
}

// Soft delete. Past checks, bonuses and ledger rows are left exactly as they
// are, and no bonus is recomputed. Returns false if no such active habit.
export function archiveHabit(id: number): boolean {
  return (
    getDb()
      .prepare(
        `UPDATE habits SET archived_at = datetime('now')
         WHERE id = ? AND archived_at IS NULL`
      )
      .run(id).changes > 0
  );
}

// Active habits plus their checks and the bonuses within [from, to].
export function getHabitWeek(from: string, to: string): HabitWeek {
  const db = getDb();
  const checks = db
    .prepare(
      `SELECT c.habit_id, c.date, c.status FROM habit_checks c
       JOIN habits h ON h.id = c.habit_id
       WHERE h.archived_at IS NULL AND c.date BETWEEN ? AND ?
       ORDER BY c.date, c.habit_id`
    )
    .all(from, to) as { habit_id: number; date: string; status: CheckStatus }[];
  const bonuses = db
    .prepare(
      `SELECT b.date, l.points FROM habit_bonus b
       LEFT JOIN ledger l ON l.id = b.ledger_id AND l.type = 'earn'
       WHERE b.date BETWEEN ? AND ? ORDER BY b.date`
    )
    .all(from, to) as { date: string; points: number | null }[];
  return { habits: getActiveHabits(), checks, bonuses, bonusPoints: getBonusPoints() };
}

export type SetHabitStatusResult =
  | { found: false }
  | {
      found: true;
      status: CheckStatus | null;
      bonus: boolean;
      newBalance: number;
    };

// Set a habit's mark for a date: "done" (earns its points), "missed" (earns
// nothing) or null (clear). Idempotent. done -> missed deletes the earned
// ledger row; missed -> done creates one. Runs in one transaction together
// with the bonus recompute for that date.
export function setHabitStatus(
  habitId: number,
  date: string,
  status: CheckStatus | null
): SetHabitStatusResult {
  const db = getDb();
  const tx = db.transaction((): SetHabitStatusResult => {
    const habit = db
      .prepare(`SELECT id, name, points FROM habits WHERE id = ? AND archived_at IS NULL`)
      .get(habitId) as { id: number; name: string; points: number } | undefined;
    if (!habit) return { found: false };

    const check = db
      .prepare(`SELECT status, ledger_id FROM habit_checks WHERE habit_id = ? AND date = ?`)
      .get(habitId, date) as { status: CheckStatus; ledger_id: number | null } | undefined;

    // The earned ledger row may already be gone (removed from the dashboard).
    const dropLedger = () => {
      if (check?.ledger_id != null) {
        db.prepare(`DELETE FROM ledger WHERE id = ? AND type = 'earn'`).run(check.ledger_id);
      }
    };
    const earn = () =>
      db
        .prepare(
          `INSERT INTO ledger (type, points, source_id, description)
           VALUES ('earn', ?, ?, ?)`
        )
        .run(habit.points, `habit:${habit.id}:${date}`, `Habit: ${habit.name}`)
        .lastInsertRowid;

    if (status === null) {
      if (check) {
        dropLedger();
        db.prepare(`DELETE FROM habit_checks WHERE habit_id = ? AND date = ?`).run(habitId, date);
      }
    } else if (!check) {
      const ledgerId = status === "done" ? earn() : null;
      db.prepare(
        `INSERT INTO habit_checks (habit_id, date, ledger_id, status) VALUES (?, ?, ?, ?)`
      ).run(habitId, date, ledgerId, status);
    } else if (check.status !== status) {
      let ledgerId: number | bigint | null = null;
      if (status === "done") ledgerId = earn();
      else dropLedger();
      db.prepare(
        `UPDATE habit_checks SET status = ?, ledger_id = ? WHERE habit_id = ? AND date = ?`
      ).run(status, ledgerId, habitId, date);
    }

    const bonus = recomputeBonus(date);
    return { found: true, status, bonus, newBalance: getBalance() };
  });
  return tx();
}

// Award or revoke the all-habits bonus for one date. Eligible habits are the
// active ones created on or before that date; every one must be marked
// 'done' (a 'missed' or unmarked habit blocks the bonus). NOTE: created_at is a UTC
// timestamp while `date` is the user's local date, so a habit added late in a
// US evening (already the next day in UTC) is not required for that evening's
// bonus — a lenient edge, accepted for simplicity. Returns whether a bonus row
// exists for the date afterwards. Must run inside the caller's transaction.
function recomputeBonus(date: string): boolean {
  const db = getDb();
  const { eligible, checked } = db
    .prepare(
      `SELECT COUNT(*) AS eligible,
              COUNT(c.habit_id) AS checked
       FROM habits h
       LEFT JOIN habit_checks c
         ON c.habit_id = h.id AND c.date = ? AND c.status = 'done'
       WHERE h.archived_at IS NULL AND date(h.created_at) <= ?`
    )
    .get(date, date) as { eligible: number; checked: number };
  const allDone = eligible > 0 && checked === eligible;

  const existing = db
    .prepare(`SELECT ledger_id FROM habit_bonus WHERE date = ?`)
    .get(date) as { ledger_id: number | null } | undefined;

  if (allDone) {
    if (existing) return true; // already awarded; keep its captured value
    const points = getBonusPoints();
    if (points <= 0) return false; // bonus switched off
    const ledgerId = db
      .prepare(
        `INSERT INTO ledger (type, points, source_id, description)
         VALUES ('earn', ?, ?, ?)`
      )
      .run(points, `habit-bonus:${date}`, `All habits done (${date})`).lastInsertRowid;
    db.prepare(`INSERT INTO habit_bonus (date, ledger_id) VALUES (?, ?)`).run(date, ledgerId);
    return true;
  }

  if (existing) {
    if (existing.ledger_id != null) {
      db.prepare(`DELETE FROM ledger WHERE id = ? AND type = 'earn'`).run(existing.ledger_id);
    }
    db.prepare(`DELETE FROM habit_bonus WHERE date = ?`).run(date);
  }
  return false;
}
