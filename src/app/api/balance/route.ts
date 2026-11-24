import { NextResponse } from "next/server";
import { BALANCE_MAX, BALANCE_MIN, setBalance } from "@/lib/queries";
import { parseIntInRange } from "@/lib/validate";

// POST: set the balance to an exact value. Body: { balance } — integer in
// [BALANCE_MIN, BALANCE_MAX] (negative allowed: the balance may be owed). Records the difference as a balance adjustment (shown in the
// dashboard history); ledger rows and lifetime totals are untouched.
export async function POST(req: Request) {
  try {
    const body = ((await req.json().catch(() => null)) ?? {}) as { balance?: unknown };
    // parseIntInRange refuses null/""/booleans/arrays, which Number() would
    // silently coerce to 0 or 1 and so reset the balance.
    const target = parseIntInRange(body.balance, BALANCE_MIN, BALANCE_MAX);
    if (target === null) {
      return NextResponse.json(
        { error: `Balance must be an integer between ${BALANCE_MIN} and ${BALANCE_MAX}` },
        { status: 400 }
      );
    }
    const { newBalance, delta } = setBalance(target);
    return NextResponse.json({ ok: true, newBalance, delta });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to set balance" },
      { status: 500 }
    );
  }
}
