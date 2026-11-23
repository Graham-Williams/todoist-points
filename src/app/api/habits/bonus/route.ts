import { NextResponse } from "next/server";
import { BONUS_POINTS_MAX, setBonusPoints } from "@/lib/habits";
import { parseIntInRange } from "@/lib/validate";

// PUT { points }: the all-habits bonus, integer in [0, 100000] (0 = no bonus).
// Applies to bonuses awarded from now on; past bonuses keep their value.
export async function PUT(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { points?: unknown };
    const points = parseIntInRange(body.points, 0, BONUS_POINTS_MAX);
    if (points === null) {
      return NextResponse.json(
        { error: `Bonus must be an integer between 0 and ${BONUS_POINTS_MAX}` },
        { status: 400 }
      );
    }
    return NextResponse.json(setBonusPoints(points));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save bonus" }, { status: 500 });
  }
}
