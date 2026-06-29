import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getRewards } from "@/lib/queries";

// GET: list all rewards.
export async function GET() {
  return NextResponse.json({ rewards: getRewards() });
}

// POST: create a reward. Body: { name, cost }
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { name?: string; cost?: number };
    const name = (body.name ?? "").trim();
    const cost = Math.trunc(Number(body.cost));
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (!Number.isFinite(cost) || cost < 0) {
      return NextResponse.json(
        { error: "Cost must be a non-negative number" },
        { status: 400 }
      );
    }
    const db = getDb();
    const info = db
      .prepare(`INSERT INTO rewards (name, cost, active) VALUES (?, ?, 1)`)
      .run(name, cost);
    return NextResponse.json({ ok: true, id: info.lastInsertRowid });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
