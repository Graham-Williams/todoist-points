import { getDb } from "./db";
import { earningTitle } from "./earningSource";
import { applyOrder } from "./order";

// Re-exported so callers can keep importing it from "@/lib/queries". The
// implementation lives in ./order (dependency-free) so it is unit-testable
// without triggering the native better-sqlite3 import. See order.test.ts.
export { applyOrder };

export interface LedgerEntry {
  id: number;
  type: "earn" | "redeem";
  points: number;
  source_id: string | null;
  description: string | null;
  created_at: string;
}

export interface Reward {
  id: number;
  name: string;
  description: string | null;
  cost: number;
  active: number;
  created_at: string;
}

// A recent earning/loss row prepared for display: the ledger id/points plus
// the clean task title (legacy provenance suffixes stripped, see
// earningSource.ts). points is signed: a missed-habit penalty is negative.
export interface RecentEarning {
  id: number;
  points: number;
  title: string;
}

// One row of the dashboard "Spending & adjustments" history: a reward
// redemption (negative ledger row) or a manual balance adjustment.
export interface HistoryEntry {
  kind: "redeem" | "adjust";
  id: number;
  points: number; // signed: redemptions negative, adjustments +/- delta
  description: string | null;
  created_at: string;
}

export interface DashboardStats {
  balance: number;
  netEarned: number; // every earn row: earnings minus habit penalties
  totalSpent: number;
  recentEarnings: RecentEarning[];
  history: HistoryEntry[];
}

export function getStats(): DashboardStats {
  const db = getDb();
  // Net earned: earn rows are positive, except missed-habit penalties, which
  // are negative earn rows, so the sum is earnings minus losses. Together with
  // spent and the adjustments it explains the balance:
  // balance = netEarned - totalSpent + SUM(adjustments).
  const earned =
    (db
      .prepare(`SELECT COALESCE(SUM(points), 0) AS s FROM ledger WHERE type = 'earn'`)
      .get() as { s: number }).s ?? 0;
  // redeem rows store negative points, so spent = -SUM.
  const spent =
    (db
      .prepare(`SELECT COALESCE(SUM(points), 0) AS s FROM ledger WHERE type = 'redeem'`)
      .get() as { s: number }).s ?? 0;

  // Earnings and losses (negative penalty rows) together. Zero-point rows are
  // never recorded, but are filtered defensively so any stale ones stay
  // invisible.
  const recentEarnings = (
    db
      .prepare(
        `SELECT * FROM ledger WHERE type = 'earn' AND points != 0 ORDER BY id DESC LIMIT 20`
      )
      .all() as LedgerEntry[]
  ).map((e): RecentEarning => ({
    id: e.id,
    points: e.points,
    title: earningTitle(e.description),
  }));

  const history = db
    .prepare(
      `SELECT 'redeem' AS kind, id, points, description, created_at
         FROM ledger WHERE type = 'redeem'
       UNION ALL
       SELECT 'adjust' AS kind, id, delta AS points, note AS description, created_at
         FROM balance_adjustments
       ORDER BY created_at DESC, id DESC
       LIMIT 20`
    )
    .all() as HistoryEntry[];

  return {
    balance: getBalance(),
    netEarned: earned,
    totalSpent: spent === 0 ? 0 : -spent,
    recentEarnings,
    history,
  };
}

// THE balance. Every balance shown or checked anywhere (dashboard, rewards
// page, redeem check, review/ledger/habit responses) goes through here so the
// two sources can't drift: every ledger row plus every manual adjustment.
export function getBalance(): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT (SELECT COALESCE(SUM(points), 0) FROM ledger)
            + (SELECT COALESCE(SUM(delta), 0) FROM balance_adjustments) AS s`
    )
    .get() as { s: number };
  return row.s ?? 0;
}

export const BALANCE_MAX = 1000000;
// The balance may be set below zero (habit penalties can take it there anyway).
export const BALANCE_MIN = -BALANCE_MAX;

// Set the balance to exactly `target` (an integer in [BALANCE_MIN,
// BALANCE_MAX]) by recording the needed delta as a balance_adjustments row
// (read + insert in one transaction). A zero delta records nothing. Ledger
// history and lifetime totals are untouched.
export function setBalance(target: number): {
  ok: true;
  newBalance: number;
  delta: number;
} {
  if (!Number.isInteger(target) || target < BALANCE_MIN || target > BALANCE_MAX) {
    throw new RangeError(
      `Balance must be an integer between ${BALANCE_MIN} and ${BALANCE_MAX}`
    );
  }
  const db = getDb();
  const tx = db.transaction(() => {
    const delta = target - getBalance();
    if (delta !== 0) {
      db.prepare(
        `INSERT INTO balance_adjustments (delta, note) VALUES (?, ?)`
      ).run(delta, `Balance set to ${target}`);
    }
    return delta;
  });
  const delta = tx();
  return { ok: true, newBalance: getBalance(), delta };
}

export function getRewards(): Reward[] {
  const db = getDb();
  // Natural order is stable creation order; manual drag order (if any) then
  // governs via applyOrder. Deactivated rewards keep their opacity styling but
  // are no longer force-sorted to the bottom — that's intended.
  const rows = db
    .prepare(`SELECT * FROM rewards ORDER BY id ASC`)
    .all() as Reward[];
  return applyOrder(rows, (r) => String(r.id), getOrderMap("rewards"));
}

// ---------------------------------------------------------------------------
// Per-list manual ordering (generic, one `list_order` table for every list)
// ---------------------------------------------------------------------------
// Lists that can be manually reordered. Any other value is rejected by
// setOrder so a bad/typo'd list name can never write orphan rows.
export const ORDER_LISTS = new Set(["rewards", "review", "upcoming", "habits"]);

// item_key -> position for a given list (used to left-join a list's rows so a
// reload reflects the user's dragged order).
export function getOrderMap(list: string): Record<string, number> {
  const db = getDb();
  const rows = db
    .prepare(`SELECT item_key, position FROM list_order WHERE list = ?`)
    .all(list) as { item_key: string; position: number }[];
  const map: Record<string, number> = {};
  for (const r of rows) map[r.item_key] = r.position;
  return map;
}

// Persist a full ordering for a list: replace all of its rows with the given
// keys at positions 0..n-1, in a single transaction. Keys are coerced with
// String(); the list name is validated against ORDER_LISTS and an absurd
// length is rejected as a cheap DoS guard.
export function setOrder(list: string, keys: string[]): { ok: true } {
  if (!ORDER_LISTS.has(list)) {
    throw new Error(`Unknown list: ${list}`);
  }
  if (keys.length > 5000) {
    throw new Error("Too many keys");
  }
  // De-duplicate on the String()-coerced key, preserving first occurrence, so a
  // repeated item_key can't violate PRIMARY KEY (list, item_key) and 500 the
  // request. Positions stay 0..n-1 over the de-duped list.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const k of keys) {
    const key = String(k);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(key);
    }
  }
  const db = getDb();
  const del = db.prepare(`DELETE FROM list_order WHERE list = ?`);
  const ins = db.prepare(
    `INSERT INTO list_order (list, item_key, position) VALUES (?, ?, ?)`
  );
  const tx = db.transaction((ks: string[]) => {
    del.run(list);
    ks.forEach((k, i) => ins.run(list, k, i));
  });
  tx(deduped);
  return { ok: true };
}

export interface PendingReviewRow {
  completion_id: string;
  content: string;
  completed_at: string | null;
}

// All completions awaiting manual review, newest completed first, then the
// user's drag order. (The table's legacy `labels` column is not exposed.)
export function getPendingReview(): PendingReviewRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT completion_id, content, completed_at
       FROM pending_review
       ORDER BY completed_at DESC, created_at DESC`
    )
    .all() as PendingReviewRow[];
  return applyOrder(rows, (r) => r.completion_id, getOrderMap("review"));
}

export function getPendingReviewCount(): number {
  const db = getDb();
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM pending_review`).get() as {
      c: number;
    }
  ).c;
}

// Manually award points to a queued completion: record an 'earn' ledger row
// and drop it from the review queue. The completion stays in
// processed_completions, so it is never re-queued. Returns the new balance.
export function awardPendingReview(
  completionId: string,
  points: number
): { ok: true; newBalance: number } {
  if (!Number.isInteger(points) || points < 1 || points > 100000) {
    throw new Error("Points must be a positive integer no greater than 100000");
  }
  const db = getDb();
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT content FROM pending_review WHERE completion_id = ?`
      )
      .get(completionId) as { content: string } | undefined;
    if (!row) {
      throw new Error("Pending review item not found");
    }
    db.prepare(
      `INSERT INTO ledger (type, points, source_id, description)
       VALUES ('earn', ?, ?, ?)`
    ).run(points, completionId, `${row.content} (manual review)`);
    db.prepare(`DELETE FROM pending_review WHERE completion_id = ?`).run(
      completionId
    );
  });
  tx();
  return { ok: true, newBalance: getBalance() };
}

// Remove a single earning from the ledger (e.g. points from a stray/test task).
// CRITICAL INVARIANT: this deletes the `ledger` row ONLY and leaves
// `processed_completions` untouched. The earning's source_id is the Todoist
// completion id, which stays in processed_completions from sync; auto-sync skips
// any completion already there (see src/app/api/sync/route.ts), so leaving the
// row is exactly what prevents the removed earning from being re-awarded on the
// next sync. The `type = 'earn'` clause is a hard guard so this can never delete
// a `redeem` row (which would inflate the balance).
export function deleteEarning(
  id: number
): { ok: true; deleted: boolean; newBalance: number } {
  if (!Number.isInteger(id) || id < 1) {
    throw new Error("id must be a positive integer");
  }
  const db = getDb();
  const result = db
    .prepare(`DELETE FROM ledger WHERE id = ? AND type = 'earn'`)
    .run(id);
  return { ok: true, deleted: result.changes > 0, newBalance: getBalance() };
}

// Edit the points on a single earning (ledger row of type 'earn') by id.
// `points` is the MAGNITUDE (1..100000): the row keeps its sign, so a loss (a
// negative missed-habit penalty row) stays a loss — editing a −5 row to 8
// stores −8 — and a gain stays a gain.
// INVARIANT: this touches ONLY the ledger row's `points` column. It does NOT
// touch processed_completions (the completion stays processed, so sync never
// re-awards it — unchanged by an edit) and does NOT touch source_id /
// description / type / created_at. The `type = 'earn'` clause is a hard guard so
// a `redeem` row can never be edited here (editing a redeem id reports
// updated=false → the route 404s). Balance re-derives from SUM(points).
export function updateEarningPoints(
  id: number,
  points: number
): { ok: true; updated: boolean; newBalance: number } {
  if (!Number.isInteger(id) || id < 1) {
    throw new Error("id must be a positive integer");
  }
  if (!Number.isInteger(points) || points < 1 || points > 100000) {
    throw new Error("Points must be a positive integer no greater than 100000");
  }
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE ledger SET points = CASE WHEN points < 0 THEN -? ELSE ? END
       WHERE id = ? AND type = 'earn'`
    )
    .run(points, points, id);
  return { ok: true, updated: result.changes > 0, newBalance: getBalance() };
}

// ---------------------------------------------------------------------------
// Task point overrides (points set ahead of time for upcoming, dated tasks)
// ---------------------------------------------------------------------------
// An override, keyed by the ACTIVE Todoist task id, records a point value that
// sync awards EXACTLY when that task is completed — skipping the review queue
// (see the sync route). The row is deleted when it fires, so it never lingers.

export const OVERRIDE_POINTS_MAX = 100000;

export interface TaskOverrideRow {
  task_id: string;
  points: number;
  content: string | null;
}

// All saved overrides as task_id -> points (left-joined onto the live task
// list so saved values re-display on reload).
export function getTaskOverridesMap(): Record<string, number> {
  const rows = getDb()
    .prepare(`SELECT task_id, points FROM task_point_overrides`)
    .all() as { task_id: string; points: number }[];
  const map: Record<string, number> = {};
  for (const r of rows) map[r.task_id] = r.points;
  return map;
}

export function getTaskOverride(taskId: string): TaskOverrideRow | undefined {
  return getDb()
    .prepare(
      `SELECT task_id, points, content FROM task_point_overrides WHERE task_id = ?`
    )
    .get(taskId) as TaskOverrideRow | undefined;
}

// Create or update an override. Points must be an integer in [1, 100000];
// clearing is a DELETE (deleteTaskOverride), never a 0 upsert.
export function upsertTaskOverride(
  taskId: string,
  points: number,
  content: string | null
): { ok: true } {
  if (!Number.isInteger(points) || points < 1 || points > OVERRIDE_POINTS_MAX) {
    throw new RangeError(
      `Points must be an integer between 1 and ${OVERRIDE_POINTS_MAX}`
    );
  }
  getDb()
    .prepare(
      `INSERT INTO task_point_overrides (task_id, points, content)
       VALUES (?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET points = excluded.points,
                                          content = excluded.content`
    )
    .run(taskId, points, content);
  return { ok: true };
}

// Whether a Todoist task id is already in processed_completions. Sync dedupes
// on that id BEFORE looking up an override, so an override on such an id
// (a reopened-then-recompleted task, or a recurring task whose completions
// reuse the id) could never pay out — Upcoming hides and refuses those.
export function isCompletionProcessed(taskId: string): boolean {
  return !!getDb()
    .prepare(`SELECT 1 FROM processed_completions WHERE completion_id = ?`)
    .get(taskId);
}

// Clear an override. Idempotent.
export function deleteTaskOverride(taskId: string): { ok: true; deleted: boolean } {
  const result = getDb()
    .prepare(`DELETE FROM task_point_overrides WHERE task_id = ?`)
    .run(taskId);
  return { ok: true, deleted: result.changes > 0 };
}

// Discard a queued completion without awarding points. It stays in
// processed_completions so it won't be re-added on the next sync.
export function discardPendingReview(completionId: string): { ok: true } {
  const db = getDb();
  db.prepare(`DELETE FROM pending_review WHERE completion_id = ?`).run(
    completionId
  );
  return { ok: true };
}

// Discard a batch of queued completions at once ("Discard all" on /review).
// Only the given ids are deleted — the page sends exactly the items it is
// showing, so anything auto-sync queued after the page loaded survives. Like a
// single discard, every completion stays in processed_completions, so none is
// ever re-queued. Returns how many rows were actually deleted.
export function discardPendingReviewIds(ids: string[]): {
  ok: true;
  discarded: number;
} {
  const db = getDb();
  const del = db.prepare(`DELETE FROM pending_review WHERE completion_id = ?`);
  const tx = db.transaction((list: string[]) => {
    let n = 0;
    for (const id of list) n += del.run(id).changes;
    return n;
  });
  return { ok: true, discarded: tx(ids) };
}
