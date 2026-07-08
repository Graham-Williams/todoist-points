import { getDb } from "./db";
import { parseEarning, type EarningBadge } from "./earningSource";

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

export interface LabelPoint {
  label_name: string;
  points: number;
}

// A recent-earning row prepared for display: the raw ledger fields plus the
// clean task title and source badges parsed off its description suffix.
export interface RecentEarning {
  id: number;
  points: number;
  title: string;
  badges: EarningBadge[];
}

export interface DashboardStats {
  balance: number;
  totalEarned: number;
  totalSpent: number;
  recentEarnings: RecentEarning[];
  redemptions: LedgerEntry[];
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
  ).map((e): RecentEarning => {
    const { title, badges } = parseEarning(e.description);
    return { id: e.id, points: e.points, title, badges };
  });

  const redemptions = db
    .prepare(
      `SELECT * FROM ledger WHERE type = 'redeem' ORDER BY id DESC LIMIT 20`
    )
    .all() as LedgerEntry[];

  return {
    balance: earned + spent,
    totalEarned: earned,
    totalSpent: -spent,
    recentEarnings,
    redemptions,
  };
}

export function getBalance(): number {
  const db = getDb();
  return (
    (db.prepare(`SELECT COALESCE(SUM(points), 0) AS s FROM ledger`).get() as {
      s: number;
    }).s ?? 0
  );
}

export function getLabelPointsMap(): Record<string, number> {
  const db = getDb();
  const rows = db.prepare(`SELECT label_name, points FROM label_points`).all() as
    LabelPoint[];
  const map: Record<string, number> = {};
  for (const r of rows) map[r.label_name] = r.points;
  return map;
}

export function getRewards(): Reward[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM rewards ORDER BY active DESC, id DESC`)
    .all() as Reward[];
}

export interface PendingReviewRow {
  completion_id: string;
  content: string;
  labels: string[];
  completed_at: string | null;
}

interface PendingReviewDbRow {
  completion_id: string;
  content: string;
  labels: string | null;
  completed_at: string | null;
}

function parseLabels(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

// All completions awaiting manual review (synced with 0 points), newest
// completed first. Labels JSON is parsed to an array for the client.
export function getPendingReview(): PendingReviewRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT completion_id, content, labels, completed_at
       FROM pending_review
       ORDER BY completed_at DESC, created_at DESC`
    )
    .all() as PendingReviewDbRow[];
  return rows.map((r) => ({
    completion_id: r.completion_id,
    content: r.content,
    labels: parseLabels(r.labels),
    completed_at: r.completed_at,
  }));
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

// ---------------------------------------------------------------------------
// Task point overrides (manual pre-assignment for upcoming, dated tasks)
// ---------------------------------------------------------------------------
// A manual override, keyed by the ACTIVE Todoist task id, records a point value
// to award EXACTLY when that task is later completed — beating the label-based
// points entirely (see the sync route). Overrides are for uncompleted tasks; a
// row is deleted when it fires (the task is done) so it never lingers.

export interface TaskOverrideRow {
  task_id: string;
  points: number;
  content: string | null;
}

// All saved overrides as a map task_id -> points. Used to left-join the
// upcoming task list so saved values re-display on reload.
export function getTaskOverridesMap(): Record<string, number> {
  const db = getDb();
  const rows = db
    .prepare(`SELECT task_id, points FROM task_point_overrides`)
    .all() as { task_id: string; points: number }[];
  const map: Record<string, number> = {};
  for (const r of rows) map[r.task_id] = r.points;
  return map;
}

// Look up a single override by task id (used by sync on each completed task).
export function getTaskOverride(taskId: string): TaskOverrideRow | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT task_id, points, content FROM task_point_overrides WHERE task_id = ?`
    )
    .get(taskId) as TaskOverrideRow | undefined;
}

// Upsert (create or update) an override. Points must be a positive integer;
// clearing is a DELETE (deleteTaskOverride), never a 0 upsert.
export function upsertTaskOverride(
  taskId: string,
  points: number,
  content: string | null
): { ok: true } {
  if (!Number.isInteger(points) || points < 1 || points > 100000) {
    throw new Error("Points must be a positive integer no greater than 100000");
  }
  const db = getDb();
  db.prepare(
    `INSERT INTO task_point_overrides (task_id, points, content)
     VALUES (?, ?, ?)
     ON CONFLICT(task_id) DO UPDATE SET points = excluded.points,
                                        content = excluded.content`
  ).run(taskId, points, content);
  return { ok: true };
}

// Clear an override (the "Clear" control, and the sync-time cleanup when an
// override fires). Idempotent.
export function deleteTaskOverride(taskId: string): {
  ok: true;
  deleted: boolean;
} {
  const db = getDb();
  const result = db
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
