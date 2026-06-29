import { NextResponse } from "next/server";
import { getPendingReview } from "@/lib/queries";

// GET: list completions awaiting manual review (synced with 0 points).
export async function GET() {
  try {
    return NextResponse.json({ tasks: getPendingReview() });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
