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

export const DESCRIPTION_MAX = 500;

// An optional free-text description: absent/null/blank -> null, otherwise the
// trimmed string (at most `max` chars). Returns undefined when invalid (a
// non-string, or too long after trimming).
export function parseDescription(
  raw: unknown,
  max: number = DESCRIPTION_MAX
): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return trimmed.length <= max ? trimmed : undefined;
}

export const HABIT_NAME_MAX = 100;
export const HABIT_POINTS_MAX = 100000;

export interface HabitInput {
  name?: string;
  description?: string | null;
  points?: number;
}

// Validate a habit body for create (all of name + points required, description
// optional) or for a partial edit (any subset, but at least one field).
// name: trimmed, 1–100 chars. description: see parseDescription. points:
// integer in [1, 100000].
export function parseHabitInput(
  body: unknown,
  partial: boolean
): { ok: true; value: HabitInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  const value: HabitInput = {};
  if (b.name !== undefined || !partial) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (name.length < 1 || name.length > HABIT_NAME_MAX) {
      return { ok: false, error: `Name must be 1–${HABIT_NAME_MAX} characters` };
    }
    value.name = name;
  }
  if (b.description !== undefined) {
    const description = parseDescription(b.description);
    if (description === undefined) {
      return {
        ok: false,
        error: `Description must be text of at most ${DESCRIPTION_MAX} characters`,
      };
    }
    value.description = description;
  }
  if (b.points !== undefined || !partial) {
    const points = parseIntInRange(b.points, 1, HABIT_POINTS_MAX);
    if (points === null) {
      return {
        ok: false,
        error: `Points must be an integer between 1 and ${HABIT_POINTS_MAX}`,
      };
    }
    value.points = points;
  }
  if (partial && Object.keys(value).length === 0) {
    return { ok: false, error: "Nothing to update (name, description or points)" };
  }
  return { ok: true, value };
}
