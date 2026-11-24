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
