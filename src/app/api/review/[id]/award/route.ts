import { NextResponse } from "next/server";
import { awardPendingReview } from "@/lib/queries";

// POST: award points to a queued completion. Body: { points }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { points?: number };
    const points = Number(body.points);
    if (!Number.isInteger(points) || points < 1 || points > 100000) {
      return NextResponse.json(
        { error: "Points must be an integer between 1 and 100000" },
        { status: 400 }
      );
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
