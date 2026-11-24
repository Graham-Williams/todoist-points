import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getBalance } from "@/lib/queries";
import { parseId } from "@/lib/validate";

// POST: redeem a reward — records a spend of its cost in the ledger.
// Optional body { allowNegative: true }: redeem even if that takes the balance
// below zero (the page asks first). Without it, a balance below the cost is a
// 400 with code "insufficient_balance" plus { balance, cost }, so the client
// can ask and retry with the flag. allowNegative must be a boolean when given.
// Optional expectedCost: the cost the client showed; when given it must be an
// integer (400 otherwise) and equal the reward's current cost, else 409 with
// code "cost_changed" and the current cost, and nothing is recorded — so a
// confirmation can never charge a different amount than it displayed. An
// absent or non-JSON body means neither. Inactive rewards can't be redeemed.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = parseId((await params).id);
    if (id === null) {
      return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
    }
    const body = await req.json().catch(() => null);
    const fields =
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const flag = fields.allowNegative;
    if (flag !== undefined && typeof flag !== "boolean") {
      return NextResponse.json(
        { error: "allowNegative must be true or false" },
        { status: 400 }
      );
    }
    const allowNegative = flag === true;
    const expectedCost = fields.expectedCost;
    if (
      expectedCost !== undefined &&
      !(typeof expectedCost === "number" && Number.isSafeInteger(expectedCost))
    ) {
      return NextResponse.json(
        { error: "expectedCost must be an integer" },
        { status: 400 }
      );
    }
    const db = getDb();
    // Read the reward, check it and the balance, and spend, all in one
    // transaction. getBalance() includes manual balance adjustments, so a
    // reset/override is respected here too.
    const redeem = db.transaction(() => {
      const reward = db.prepare(`SELECT * FROM rewards WHERE id = ?`).get(id) as
        | { id: number; name: string; cost: number; active: number }
        | undefined;
      if (!reward) {
        return NextResponse.json({ error: "Reward not found" }, { status: 404 });
      }
      if (!reward.active) {
        return NextResponse.json({ error: "Reward is inactive" }, { status: 400 });
      }
      if (expectedCost !== undefined && expectedCost !== reward.cost) {
        return NextResponse.json(
          {
            error: `This reward's cost changed to ${reward.cost} pts`,
            code: "cost_changed",
            cost: reward.cost,
          },
          { status: 409 }
        );
      }
      const balance = getBalance();
      if (balance < reward.cost && !allowNegative) {
        return NextResponse.json(
          {
            error: `Insufficient balance (${balance} < ${reward.cost})`,
            code: "insufficient_balance",
            balance,
            cost: reward.cost,
          },
          { status: 400 }
        );
      }
      db.prepare(
        `INSERT INTO ledger (type, points, source_id, description)
         VALUES ('redeem', ?, ?, ?)`
      ).run(-reward.cost, String(reward.id), `Redeemed: ${reward.name}`);
      return NextResponse.json({ ok: true, newBalance: balance - reward.cost });
    });
    return redeem();
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to redeem reward" },
      { status: 500 }
    );
  }
}
