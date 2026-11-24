import { NextResponse } from "next/server";
import { getRewards } from "@/lib/queries";
import { createReward } from "@/lib/rewards";
import { parseRewardInput } from "@/lib/validate";

// GET: list all rewards (with description), in drag order.
export async function GET() {
  return NextResponse.json({ rewards: getRewards() });
}

// POST { name, cost, description? }: create a reward. name is trimmed, 1–100
// chars; cost is an integer in [1, 100000]; description is optional text
// (trimmed, at most 500 chars, blank -> none).
export async function POST(req: Request) {
  try {
    const parsed = parseRewardInput(await req.json().catch(() => null), false);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { name, cost, description } = parsed.value;
    const reward = createReward(name!, cost!, description ?? null);
    return NextResponse.json({ ok: true, id: reward.id, reward });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to create reward" },
      { status: 500 }
    );
  }
}
