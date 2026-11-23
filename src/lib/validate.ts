// Small request-validation helpers shared by the habit routes. Pure, DB-free.

// A positive integer id from a route segment, strictly digits (no "1.5",
// "1e3", " 7", "-1"); null when invalid.
export function parseId(raw: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

// An integer in [min, max] from a JSON body field. Accepts a number or a
// numeric string; anything else (null, "", booleans, arrays) is rejected rather
// than coerced by Number() to 0 or 1. Returns null when invalid.
export function parseIntInRange(raw: unknown, min: number, max: number): number | null {
  if (typeof raw !== "number" && !(typeof raw === "string" && raw.trim() !== "")) {
    return null;
  }
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
