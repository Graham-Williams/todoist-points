import { NextResponse } from "next/server";
import { discardPendingReviewIds } from "@/lib/queries";

const MAX_IDS = 5000;
const MAX_ID_LEN = 200;

// POST { ids: string[] }: discard exactly these queued completions (the ones
// the review page is showing) without awarding points. Items queued by a sync
// after the page loaded are not in the list, so they survive. All ids stay in
// processed_completions, so none is re-queued. Returns the count discarded.
export async function POST(req: Request) {
  try {
    const body = ((await req.json().catch(() => null)) ?? {}) as { ids?: unknown };
    const ids = body.ids;
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > MAX_IDS ||
      !ids.every(
        (id) => typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LEN
      )
    ) {
      return NextResponse.json(
        {
          error: `ids must be a non-empty array of up to ${MAX_IDS} strings (each at most ${MAX_ID_LEN} characters)`,
        },
        { status: 400 }
      );
    }
    const { discarded } = discardPendingReviewIds(ids as string[]);
    return NextResponse.json({ ok: true, discarded });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to discard review queue" },
      { status: 500 }
    );
  }
}
