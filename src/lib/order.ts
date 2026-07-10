// Pure, dependency-free reorder helper (no DB import), so it can be unit-tested
// under `node --test` without pulling in the native better-sqlite3 module.
// Re-exported from queries.ts for convenience.

// STABLE reorder: items with a stored position come first (in position order);
// items without one keep their natural (input) order and are appended after.
export function applyOrder<T>(
  items: T[],
  keyFn: (t: T) => string,
  orderMap: Record<string, number>
): T[] {
  return items
    .map((item, idx) => ({
      item,
      idx,
      pos: orderMap[keyFn(item)] ?? Infinity,
    }))
    .sort((a, b) => a.pos - b.pos || a.idx - b.idx)
    .map((x) => x.item);
}
