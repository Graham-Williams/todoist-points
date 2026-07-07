import { NextResponse } from "next/server";
import { deleteEarning, updateEarningPoints } from "@/lib/queries";

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

// PATCH: edit the points on a single earning (ledger row of type 'earn') by id.
// Body: { points } — integer in [1, 100000]. Updates the ledger row's points
// ONLY; processed_completions is untouched so sync never re-awards it. Redeem
// rows can't be edited here (updateEarningPoints guards on type = 'earn'), so a
// redeem id reports updated=false → 404.
export async function PATCH(
  req: Request,
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
    const body = (await req.json()) as { points?: number };
    const points = Number(body.points);
    if (!Number.isInteger(points) || points < 1 || points > 100000) {
      return NextResponse.json(
        { error: "Points must be an integer between 1 and 100000" },
        { status: 400 }
      );
    }
    const { updated, newBalance } = updateEarningPoints(id, points);
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, newBalance });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update earning" },
      { status: 500 }
    );
  }
}
