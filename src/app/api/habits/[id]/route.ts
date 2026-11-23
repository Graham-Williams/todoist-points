import { NextResponse } from "next/server";
import { archiveHabit } from "@/lib/habits";
import { parseId } from "@/lib/validate";

// DELETE: remove (archive) a habit. Its past checks and earned points stay.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = parseId((await params).id);
    if (id === null) {
      return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
    }
    if (!archiveHabit(id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to remove habit" }, { status: 500 });
  }
}
