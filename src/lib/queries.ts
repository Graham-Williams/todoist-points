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
