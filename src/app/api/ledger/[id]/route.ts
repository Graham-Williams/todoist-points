import { NextResponse } from "next/server";
import { deleteEarning } from "@/lib/queries";

// DELETE: remove a single earning (ledger row of type 'earn') by id — e.g.
// points from a stray/test task. Deletes the ledger row ONLY; the completion
// stays in processed_completions so sync never re-awards it. Redeem rows can't
// be deleted here (deleteEarning guards on type = 'earn'), so a redeem id 404s.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const id = Math.trunc(Number(idParam));
    if (!Number.isInteger(id) || id < 1) {
      return NextResponse.json(
        { error: "id must be a positive integer" },
        { status: 400 }
      );
    }
    const { deleted, newBalance } = deleteEarning(id);
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, newBalance });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to remove earning" },
      { status: 500 }
    );
  }
}
