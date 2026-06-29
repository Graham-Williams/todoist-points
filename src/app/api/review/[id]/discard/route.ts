import { NextResponse } from "next/server";
import { discardPendingReview } from "@/lib/queries";

// POST: discard a queued completion without awarding points. It stays in
// processed_completions so it won't be re-queued on the next sync.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    discardPendingReview(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to discard task" },
      { status: 500 }
    );
  }
}
