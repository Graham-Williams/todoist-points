// Due-date ordering for the Review page's Upcoming list. Pure and DB-free
// (unit-tested under node --test). Runs in the BROWSER so "which day" is the
// user's local day: the server runs in UTC and the user does not.
//
// Order: earliest due first (so overdue tasks lead). Within a day, timed tasks
// come first in time order, then all-day tasks (as Todoist lists them). Tasks
// with no due date (listed only because points are saved) go last. Ties break
// on content, then id, so the order is stable across reloads.

export interface DueLike {
  date: string;
  datetime?: string | null;
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FLOATING_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

// [ms, rank]: rank 0 = timed, 1 = all-day, 2 = no due date / unparseable.
// An all-day task sorts at the very end of its local day, after its timed tasks.
export function dueSortKey(due: DueLike | null): [number, number] {
  if (!due) return [Infinity, 2];
  const raw = due.datetime || due.date;
  let m = DATE_ONLY_RE.exec(raw);
  if (m) {
    const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1).getTime() - 1;
    return [end, 1];
  }
  // Floating time (no zone): a wall-clock time in the user's own timezone.
  m = FLOATING_RE.exec(raw);
  if (m) {
    const ms = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6] ?? 0)
    ).getTime();
    return [ms, 0];
  }
  // Fixed-zone time ("...Z" or "+hh:mm"): an absolute instant.
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? [Infinity, 2] : [ms, 0];
}

export function sortByDue<T extends { id: string; content: string; due: DueLike | null }>(
  tasks: readonly T[]
): T[] {
  const keyed = tasks.map((t) => ({ t, k: dueSortKey(t.due) }));
  keyed.sort(
    (a, b) =>
      (a.k[0] === b.k[0] ? 0 : a.k[0] < b.k[0] ? -1 : 1) ||
      a.k[1] - b.k[1] ||
      a.t.content.localeCompare(b.t.content) ||
      (a.t.id < b.t.id ? -1 : a.t.id > b.t.id ? 1 : 0)
  );
  return keyed.map((x) => x.t);
}
