import { NextResponse } from "next/server";
import { archiveHabit, updateHabit } from "@/lib/habits";
import { parseHabitInput, parseId } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

// PATCH { name?, description?, points?, penalty? }: edit an active habit (same
// validation as create; at least one field; penalty null or 0 clears it).
// Points and penalty changes apply to future marks only — ledger rows already
// earned or lost keep their value. 404 for unknown/archived.
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const id = parseId((await params).id);
    if (id === null) {
      return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
    }
    const parsed = parseHabitInput(await req.json().catch(() => null), true);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const habit = updateHabit(id, parsed.value);
    if (!habit) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, habit });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update habit" }, { status: 500 });
  }
}

// DELETE: remove (archive) a habit. Its past checks and earned points stay.
export async function DELETE(_req: Request, { params }: Ctx) {
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
