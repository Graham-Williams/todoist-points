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
    if (!Number.isInteger(points) || points < 1) {
      return NextResponse.json(
        { error: "Points must be an integer >= 1" },
        { status: 400 }
      );
    }
    const result = awardPendingReview(id, points);
    return NextResponse.json({ ok: true, newBalance: result.newBalance });
  } catch (err) {
    const message = (err as Error).message;
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
