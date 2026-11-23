import { NextResponse } from "next/server";
import {
  deleteTaskOverride,
  OVERRIDE_POINTS_MAX,
  upsertTaskOverride,
} from "@/lib/queries";
import { parseIntInRange } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

const ID_MAX = 200;
const CONTENT_MAX = 2000;

function validId(id: string): boolean {
  return id.length > 0 && id.length <= ID_MAX;
}

// PUT { points, content? }: set (create or update) the points an upcoming task
// will earn when completed. points is an integer in [1, 100000]; clearing is a
// DELETE, never a 0-point save. The id is the ACTIVE Todoist task id.
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!validId(id)) {
      return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
    }
    const body = ((await req.json().catch(() => null)) ?? {}) as {
      points?: unknown;
      content?: unknown;
    };
    const points = parseIntInRange(body.points, 1, OVERRIDE_POINTS_MAX);
    if (points === null) {
      return NextResponse.json(
        { error: `Points must be an integer between 1 and ${OVERRIDE_POINTS_MAX}` },
        { status: 400 }
      );
    }
    const content =
      typeof body.content === "string" ? body.content.slice(0, CONTENT_MAX) : null;
    upsertTaskOverride(id, points, content);
    return NextResponse.json({ ok: true, points });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save points" }, { status: 500 });
  }
}

// DELETE: clear the points set for an upcoming task (idempotent).
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!validId(id)) {
      return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
    }
    const { deleted } = deleteTaskOverride(id);
    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to clear points" }, { status: 500 });
  }
}
