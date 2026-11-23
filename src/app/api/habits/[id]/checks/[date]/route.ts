import { NextResponse } from "next/server";
import { isDateInCheckWindow, isValidDateStr } from "@/lib/dates";
import { setHabitStatus, type CheckStatus } from "@/lib/habits";
import { parseId } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string; date: string }> };

// PUT marks the habit for the date: optional JSON body { status: "done" |
// "missed" }; an absent/empty body or an object without `status` means "done"
// (backward compatible). DELETE clears the mark (either status). All
// idempotent. `date` is the client's LOCAL calendar date — the server only
// bounds it to [server UTC date - 60 days, server UTC date + 1 day].
async function mark(ctx: Ctx, status: CheckStatus | null) {
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
    const result = setHabitStatus(id, date, status);
    if (!result.found) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      status: result.status,
      done: result.status === "done",
      bonus: result.bonus,
      newBalance: result.newBalance,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update habit" }, { status: 500 });
  }
}

// Parse the optional PUT body. Returns null when invalid.
async function parseStatus(req: Request): Promise<CheckStatus | null> {
  const text = await req.text().catch(() => "");
  if (text.trim() === "") return "done";
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const status = (body as { status?: unknown }).status;
  if (status === undefined) return "done";
  return status === "done" || status === "missed" ? status : null;
}

export async function PUT(req: Request, ctx: Ctx) {
  const status = await parseStatus(req);
  if (status === null) {
    return NextResponse.json(
      { error: 'status must be "done" or "missed"' },
      { status: 400 }
    );
  }
  return mark(ctx, status);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return mark(ctx, null);
}
