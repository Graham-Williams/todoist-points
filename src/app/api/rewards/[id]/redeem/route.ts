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
    const balance = getBalance();
    if (balance < reward.cost) {
      return NextResponse.json(
        { error: `Insufficient balance (${balance} < ${reward.cost})` },
        { status: 400 }
      );
    }
    db.prepare(
      `INSERT INTO ledger (type, points, source_id, description)
       VALUES ('redeem', ?, ?, ?)`
    ).run(-reward.cost, String(reward.id), `Redeemed: ${reward.name}`);

    return NextResponse.json({ ok: true, newBalance: balance - reward.cost });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to redeem reward" },
      { status: 500 }
    );
  }
}
