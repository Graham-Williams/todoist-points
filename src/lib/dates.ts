// Calendar-date helpers for habits. Pure and DB-free (unit-tested under
// node --test). Habit dates are the CLIENT's local calendar date as a
// `YYYY-MM-DD` string: the server runs in UTC and the user does not, so the
// server never derives "today" for a habit check itself — it only bounds what
// a client may send (see isDateInCheckWindow).

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// Strict `YYYY-MM-DD` that is also a real calendar date (no 2026-02-30).
export function isValidDateStr(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1970 || y > 9999) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return (
    t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
  );
}

function toUtcMs(s: string): number {
  const [y, mo, d] = s.split("-").map(Number);
  return Date.UTC(y, mo - 1, d);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(s: string, n: number): string {
  return fromUtcMs(toUtcMs(s) + n * DAY_MS);
}

// Whole days from `a` to `b` (b - a); negative when b is before a.
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

export function utcDateStr(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// How far a habit check may stray from the server's UTC date. One day ahead
// covers every timezone east of UTC; 60 days back allows late corrections.
export const CHECK_MAX_AHEAD_DAYS = 1;
export const CHECK_MAX_BEHIND_DAYS = 60;

export function isDateInCheckWindow(s: string, now: Date = new Date()): boolean {
  const diff = daysBetween(utcDateStr(now), s);
  return diff <= CHECK_MAX_AHEAD_DAYS && diff >= -CHECK_MAX_BEHIND_DAYS;
}

// A local-time Date as `YYYY-MM-DD` (browser side: the user's own calendar).
export function localDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// The last `n` local calendar dates ending with `today`, oldest first.
export function lastNLocalDates(today: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    // Construct via (y, m, d - i) so DST shifts can't skip or repeat a day.
    out.push(
      localDateStr(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i))
    );
  }
  return out;
}
