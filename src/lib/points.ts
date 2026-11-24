// Pure display helpers for point amounts. Negatives use a real minus sign
// (U+2212), which reads as a minus at a glance where a hyphen can look like a
// dash. Dependency-free so pages and client components can share it.

export const MINUS = "−";

// A total, e.g. a balance: "15", "0", "−15".
export function formatPoints(n: number): string {
  return n < 0 ? `${MINUS}${-n}` : String(n);
}

// A change in points, always signed: "+5", "−5" ("0" for zero).
export function formatSignedPoints(n: number): string {
  return n > 0 ? `+${n}` : formatPoints(n);
}

// A balance typed into the Adjust box: optional leading minus (a hyphen, or
// the U+2212 the dashboard displays) then digits, within [-max, max]. Returns
// null for anything else ("", "-", "1.5", "1e3", " 7 x").
export function parseBalanceDraft(draft: string, max: number): number | null {
  const t = draft.trim().replace(/^\u2212/, "-");
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n >= -max && n <= max ? n : null;
}
