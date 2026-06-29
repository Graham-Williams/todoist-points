import { getDb } from "./db";

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

export interface DashboardStats {
  balance: number;
  totalEarned: number;
  totalSpent: number;
  recentEarnings: LedgerEntry[];
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

  const recentEarnings = db
    .prepare(
      `SELECT * FROM ledger WHERE type = 'earn' AND points > 0 ORDER BY id DESC LIMIT 20`
    )
    .all() as LedgerEntry[];

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
  if (!Number.isInteger(points) || points < 1) {
    throw new Error("Points must be a positive integer");
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

// Discard a queued completion without awarding points. It stays in
// processed_completions so it won't be re-added on the next sync.
export function discardPendingReview(completionId: string): { ok: true } {
  const db = getDb();
  db.prepare(`DELETE FROM pending_review WHERE completion_id = ?`).run(
    completionId
  );
  return { ok: true };
}
