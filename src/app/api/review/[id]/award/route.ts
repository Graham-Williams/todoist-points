import { NextResponse } from "next/server";
import { decodeRouteParam } from "@/lib/validate";
import {
  awardPendingReview,
  discardPendingReview,
  getBalance,
} from "@/lib/queries";

// POST: award points to a queued completion. Body: { points }
// points === 0 means "discard" — drop it from the queue with no ledger entry
// (same outcome as the Discard button); the balance is unchanged.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Ids may contain ':' (e.g. "recurring:<eventId>"); the page encodes them.
    const id = decodeRouteParam((await params).id);
    const body = (await req.json()) as { points?: number };
    const points = Number(body.points);
    if (!Number.isInteger(points) || points < 0 || points > 100000) {
      return NextResponse.json(
        { error: "Points must be an integer between 0 and 100000" },
        { status: 400 }
      );
    }
    if (points === 0) {
      discardPendingReview(id);
      return NextResponse.json({ ok: true, newBalance: getBalance() });
    }
    const result = awardPendingReview(id, points);
    return NextResponse.json({ ok: true, newBalance: result.newBalance });
  } catch (err) {
    console.error(err);
    const status = (err as Error).message.includes("not found") ? 404 : 500;
    return NextResponse.json(
      { error: "Failed to award points" },
      { status }
    );
  }
}
