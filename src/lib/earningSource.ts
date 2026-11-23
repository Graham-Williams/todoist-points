// Earning title cleanup for display.
//
// Older ledger rows bake the earning's provenance into a description suffix
// (written by earlier versions of sync and of the review award):
//
//   "<content> (manual review)"   -> awarded from the review queue by hand
//   "<content> (pre-assigned)"    -> a since-removed upcoming-task override
//   "<content> [label1, label2]"  -> a since-removed label-points auto award
//
// The dashboard shows just the task title, so this strips any one of those
// suffixes off. Parsing at read time keeps every EXISTING ledger row rendering
// cleanly with no migration. Pure and DB-free (unit-tested under node --test).

const SUFFIXES = [" (manual review)", " (pre-assigned)"];
// A trailing " [ ... ]" with no nested brackets — the label list appended by the
// old sync. Anchored to the end so brackets earlier in a title are left alone.
const LABEL_RE = /\s\[([^[\]]*[^\s[\]][^[\]]*)\]$/;

export function earningTitle(description: string | null): string {
  const raw = description ?? "";
  for (const suffix of SUFFIXES) {
    if (raw.endsWith(suffix)) return raw.slice(0, -suffix.length);
  }
  const m = raw.match(LABEL_RE);
  if (m && m[1].split(",").some((s) => s.trim() !== "")) {
    return raw.slice(0, m.index);
  }
  return raw;
}
