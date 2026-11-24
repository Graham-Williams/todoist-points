import { NextResponse } from "next/server";
import { deleteReward, updateReward } from "@/lib/rewards";
import { parseId, parseRewardInput } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

// PATCH { name?, description?, cost?, active? }: edit a reward (same
// validation as create; at least one field; description null or blank clears
// it). Name and cost changes apply to future redemptions only — past
// redemptions in the ledger keep the name and cost they were redeemed at.
// 404 for an unknown id.
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const id = parseId((await params).id);
    if (id === null) {
      return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
    }
    const parsed = parseRewardInput(await req.json().catch(() => null), true);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const reward = updateReward(id, parsed.value);
    if (!reward) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, reward });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update reward" },
      { status: 500 }
    );
  }
}

// DELETE: remove a reward. Past redemptions stay in the ledger.
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const id = parseId((await params).id);
    if (id === null) {
      return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
    }
    if (!deleteReward(id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to delete reward" },
      { status: 500 }
    );
  }
}
