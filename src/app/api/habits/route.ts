import { NextResponse } from "next/server";
import { daysBetween, isValidDateStr } from "@/lib/dates";
import { createHabit, getHabitWeek } from "@/lib/habits";
import { parseHabitInput } from "@/lib/validate";

const MAX_SPAN_DAYS = 14;

// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive, at most 14 days): active
// habits in drag order, their checks and earned bonuses in the range, and the
// current bonus setting.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!isValidDateStr(from) || !isValidDateStr(to)) {
      return NextResponse.json(
        { error: "from and to must be dates (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    const span = daysBetween(from, to);
    if (span < 0 || span >= MAX_SPAN_DAYS) {
      return NextResponse.json(
        { error: `Range must run forward and cover at most ${MAX_SPAN_DAYS} days` },
        { status: 400 }
      );
    }
    return NextResponse.json(getHabitWeek(from, to));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load habits" }, { status: 500 });
  }
}

// POST { name, points, description? }: add a habit. name is trimmed, 1–100
// chars; points is an integer in [1, 100000]; description is optional text
// (trimmed, at most 500 chars, blank -> none).
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = parseHabitInput(body, false);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { name, points, description } = parsed.value;
    return NextResponse.json({
      ok: true,
      habit: createHabit(name!, points!, description ?? null),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add habit" }, { status: 500 });
  }
}
