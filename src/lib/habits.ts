// Daily habits: tick a habit off for a date to earn its points; tick off every
// habit for a date to also earn the all-habits bonus.
//
// Dates are client-local `YYYY-MM-DD` strings (validated by the routes, see
// src/lib/dates.ts). Habit and bonus points are ordinary 'earn' ledger rows
// (source_id `habit:<id>:<date>` / `habit-bonus:<date>`), so they show in Recent
// earnings and count toward the balance. They never touch processed_completions
// or pending_review, which belong to Todoist sync.
import { getDb } from "./db";
import { applyOrder, getBalance, getOrderMap } from "./queries";

export const HABIT_NAME_MAX = 100;
export const HABIT_POINTS_MAX = 100000;
export const BONUS_POINTS_MAX = 100000;
export const DEFAULT_BONUS_POINTS = 10;
const BONUS_KEY = "habit_bonus_points";

export interface Habit {
  id: number;
  name: string;
  points: number;
  created_at: string;
}

export interface HabitWeek {
  habits: Habit[];
  checks: { habit_id: number; date: string }[];
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
      `SELECT id, name, points, created_at FROM habits
       WHERE archived_at IS NULL ORDER BY id ASC`
    )
    .all() as Habit[];
  return applyOrder(rows, (h) => String(h.id), getOrderMap("habits"));
}

export function createHabit(name: string, points: number): Habit {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > HABIT_NAME_MAX) {
    throw new RangeError(`Name must be 1–${HABIT_NAME_MAX} characters`);
  }
  if (!Number.isInteger(points) || points < 1 || points > HABIT_POINTS_MAX) {
    throw new RangeError(`Points must be an integer between 1 and ${HABIT_POINTS_MAX}`);
  }
  const db = getDb();
  const id = Number(
    db.prepare(`INSERT INTO habits (name, points) VALUES (?, ?)`).run(trimmed, points)
      .lastInsertRowid
  );
  return db
    .prepare(`SELECT id, name, points, created_at FROM habits WHERE id = ?`)
    .get(id) as Habit;
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
      `SELECT c.habit_id, c.date FROM habit_checks c
       JOIN habits h ON h.id = c.habit_id
       WHERE h.archived_at IS NULL AND c.date BETWEEN ? AND ?
       ORDER BY c.date, c.habit_id`
    )
    .all(from, to) as { habit_id: number; date: string }[];
  const bonuses = db
    .prepare(
      `SELECT b.date, l.points FROM habit_bonus b
       LEFT JOIN ledger l ON l.id = b.ledger_id AND l.type = 'earn'
       WHERE b.date BETWEEN ? AND ? ORDER BY b.date`
    )
    .all(from, to) as { date: string; points: number | null }[];
  return { habits: getActiveHabits(), checks, bonuses, bonusPoints: getBonusPoints() };
}

export type SetHabitDoneResult =
  | { found: false }
  | { found: true; done: boolean; bonus: boolean; newBalance: number };

// Mark (done = true) or unmark a habit for a date. Idempotent both ways. Runs
// in one transaction together with the bonus recompute for that date.
export function setHabitDone(
  habitId: number,
  date: string,
  done: boolean
): SetHabitDoneResult {
  const db = getDb();
  const tx = db.transaction((): SetHabitDoneResult => {
    const habit = db
      .prepare(`SELECT id, name, points FROM habits WHERE id = ? AND archived_at IS NULL`)
      .get(habitId) as { id: number; name: string; points: number } | undefined;
    if (!habit) return { found: false };

    const check = db
      .prepare(`SELECT ledger_id FROM habit_checks WHERE habit_id = ? AND date = ?`)
      .get(habitId, date) as { ledger_id: number | null } | undefined;

    if (done && !check) {
      const ledgerId = db
        .prepare(
          `INSERT INTO ledger (type, points, source_id, description)
           VALUES ('earn', ?, ?, ?)`
        )
        .run(habit.points, `habit:${habit.id}:${date}`, `Habit: ${habit.name}`)
        .lastInsertRowid;
      db.prepare(
        `INSERT INTO habit_checks (habit_id, date, ledger_id) VALUES (?, ?, ?)`
      ).run(habitId, date, ledgerId);
    } else if (!done && check) {
      // The ledger row may already be gone (removed from the dashboard).
      if (check.ledger_id != null) {
        db.prepare(`DELETE FROM ledger WHERE id = ? AND type = 'earn'`).run(check.ledger_id);
      }
      db.prepare(`DELETE FROM habit_checks WHERE habit_id = ? AND date = ?`).run(habitId, date);
    }

    const bonus = recomputeBonus(date);
    return { found: true, done, bonus, newBalance: getBalance() };
  });
  return tx();
}

// Award or revoke the all-habits bonus for one date. Eligible habits are the
// active ones created on or before that date. NOTE: created_at is a UTC
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
       LEFT JOIN habit_checks c ON c.habit_id = h.id AND c.date = ?
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
