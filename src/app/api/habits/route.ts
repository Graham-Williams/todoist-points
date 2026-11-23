import { NextResponse } from "next/server";
import { daysBetween, isValidDateStr } from "@/lib/dates";
import {
  createHabit,
  getHabitWeek,
  HABIT_NAME_MAX,
  HABIT_POINTS_MAX,
} from "@/lib/habits";
import { parseIntInRange } from "@/lib/validate";

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

// POST { name, points }: add a habit. name is trimmed, 1–100 chars; points is an
// integer in [1, 100000].
export async function POST(req: Request) {
  try {
    const body = ((await req.json().catch(() => null)) ?? {}) as {
      name?: unknown;
      points?: unknown;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 1 || name.length > HABIT_NAME_MAX) {
      return NextResponse.json(
        { error: `Name must be 1–${HABIT_NAME_MAX} characters` },
        { status: 400 }
      );
    }
    const points = parseIntInRange(body.points, 1, HABIT_POINTS_MAX);
    if (points === null) {
      return NextResponse.json(
        { error: `Points must be an integer between 1 and ${HABIT_POINTS_MAX}` },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, habit: createHabit(name, points) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add habit" }, { status: 500 });
  }
}
