import { NextResponse } from "next/server";
import { isDateInCheckWindow, isValidDateStr } from "@/lib/dates";
import { setHabitDone } from "@/lib/habits";
import { parseId } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string; date: string }> };

// PUT marks the habit done for the date; DELETE unmarks it. Both idempotent.
// `date` is the client's LOCAL calendar date — the server only bounds it to
// [server UTC date - 60 days, server UTC date + 1 day].
async function toggle(ctx: Ctx, done: boolean) {
  try {
    const { id: rawId, date } = await ctx.params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
    }
    if (!isValidDateStr(date) || !isDateInCheckWindow(date)) {
      return NextResponse.json(
        { error: "date must be a recent date (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    const result = setHabitDone(id, date, done);
    if (!result.found) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      done: result.done,
      bonus: result.bonus,
      newBalance: result.newBalance,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update habit" }, { status: 500 });
  }
}

export async function PUT(_req: Request, ctx: Ctx) {
  return toggle(ctx, true);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return toggle(ctx, false);
}
