import { NextResponse } from "next/server";
import { decodeRouteParam } from "@/lib/validate";
import { discardPendingReview } from "@/lib/queries";

// POST: discard a queued completion without awarding points. It stays in
// processed_completions so it won't be re-queued on the next sync.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Ids may contain ':' (e.g. "recurring:<eventId>"); the page encodes them.
    const id = decodeRouteParam((await params).id);
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
