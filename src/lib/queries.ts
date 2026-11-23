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
  cost: number;
  active: number;
  created_at: string;
}

// A recent-earning row prepared for display: the ledger id/points plus the
// clean task title (legacy provenance suffixes stripped, see earningSource.ts).
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
  totalEarned: number;
  totalSpent: number;
  recentEarnings: RecentEarning[];
  history: HistoryEntry[];
}

export function getStats(): DashboardStats {
  const db = getDb();
  // Only pointed (>0) earnings count. Non-pointed completions are never
  // recorded, but filter defensively so any stale rows stay invisible.
  const earned =
    (db
      .prepare(
        `SELECT COALESCE(SUM(points), 0) AS s FROM ledger WHERE type = 'earn' AND points > 0`
      )
      .get() as { s: number }).s ?? 0;
  // redeem rows store negative points, so spent = -SUM.
  const spent =
    (db
      .prepare(`SELECT COALESCE(SUM(points), 0) AS s FROM ledger WHERE type = 'redeem'`)
      .get() as { s: number }).s ?? 0;

  const recentEarnings = (
    db
      .prepare(
        `SELECT * FROM ledger WHERE type = 'earn' AND points > 0 ORDER BY id DESC LIMIT 20`
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
    totalEarned: earned,
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

// Set the balance to exactly `target` by recording the needed delta as a
// balance_adjustments row (read + insert in one transaction). A zero delta
// records nothing. Ledger history and lifetime totals are untouched.
export function setBalance(target: number): {
  ok: true;
  newBalance: number;
  delta: number;
} {
  if (!Number.isInteger(target) || target < 0 || target > BALANCE_MAX) {
    throw new RangeError(
      `Balance must be an integer between 0 and ${BALANCE_MAX}`
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
export const ORDER_LISTS = new Set(["rewards", "review", "habits"]);

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
    .prepare(`UPDATE ledger SET points = ? WHERE id = ? AND type = 'earn'`)
    .run(points, id);
  return { ok: true, updated: result.changes > 0, newBalance: getBalance() };
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

// Discard the whole review queue at once. Like a single discard, every
// completion stays in processed_completions, so none is ever re-queued.
export function discardAllPendingReview(): { ok: true; discarded: number } {
  const db = getDb();
  const tx = db.transaction(
    () => db.prepare(`DELETE FROM pending_review`).run().changes
  );
  return { ok: true, discarded: tx() };
}
