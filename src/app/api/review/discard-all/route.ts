import { NextResponse } from "next/server";
import { discardAllPendingReview } from "@/lib/queries";

// POST: discard every queued completion without awarding points. They stay in
// processed_completions so none is re-queued on the next sync.
export async function POST() {
  try {
    const { discarded } = discardAllPendingReview();
    return NextResponse.json({ ok: true, discarded });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to discard review queue" },
      { status: 500 }
    );
  }
}
