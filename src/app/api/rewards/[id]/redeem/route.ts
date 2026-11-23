import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getBalance } from "@/lib/queries";

// POST: redeem a reward — checks balance >= cost, records a spend in the ledger.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const reward = db.prepare(`SELECT * FROM rewards WHERE id = ?`).get(id) as
      | { id: number; name: string; cost: number; active: number }
      | undefined;
    if (!reward) {
      return NextResponse.json({ error: "Reward not found" }, { status: 404 });
    }
    if (!reward.active) {
      return NextResponse.json(
        { error: "Reward is inactive" },
        { status: 400 }
      );
    }
    // Check + spend in one transaction. getBalance() includes manual balance
    // adjustments, so a reset/override is respected here too.
    const redeem = db.transaction(() => {
      const balance = getBalance();
      if (balance < reward.cost) return { ok: false as const, balance };
      db.prepare(
        `INSERT INTO ledger (type, points, source_id, description)
         VALUES ('redeem', ?, ?, ?)`
      ).run(-reward.cost, String(reward.id), `Redeemed: ${reward.name}`);
      return { ok: true as const, balance: balance - reward.cost };
    });
    const result = redeem();
    if (!result.ok) {
      return NextResponse.json(
        { error: `Insufficient balance (${result.balance} < ${reward.cost})` },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, newBalance: result.balance });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to redeem reward" },
      { status: 500 }
    );
  }
}
