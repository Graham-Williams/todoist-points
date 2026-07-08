import { NextResponse } from "next/server";
import { upsertTaskOverride, deleteTaskOverride } from "@/lib/queries";

// PUT: save (create or update) a manual point override for an upcoming task.
// Body: { points, content? } — points is an integer in [1, 100000]. Clearing is
// a DELETE (below), never a 0-point upsert. The id is the ACTIVE Todoist task id.
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing task id" }, { status: 400 });
    }
    const body = (await req.json()) as { points?: number; content?: string };
    const points = Number(body.points);
    if (!Number.isInteger(points) || points < 1 || points > 100000) {
      return NextResponse.json(
        { error: "Points must be an integer between 1 and 100000" },
        { status: 400 }
      );
    }
    const content =
      typeof body.content === "string" ? body.content : null;
    upsertTaskOverride(id, points, content);
    return NextResponse.json({ ok: true, points });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to save override" },
      { status: 500 }
    );
  }
}

// DELETE: clear an override for an upcoming task (idempotent).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing task id" }, { status: 400 });
    }
    const { deleted } = deleteTaskOverride(id);
    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to clear override" },
      { status: 500 }
    );
  }
}
