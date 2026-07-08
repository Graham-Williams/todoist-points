// Earning "source" derivation.
//
// The ledger `description` column bakes the earning's provenance into a text
// suffix at write time (see src/app/api/sync/route.ts and awardPendingReview in
// src/lib/queries.ts):
//
//   "<content> (manual review)"   -> awarded from the review queue by hand
//   "<content> (pre-assigned)"    -> fired from an upcoming-task point override
//   "<content> [label1, label2]"  -> auto-synced; value came from those labels
//   "<content>"                   -> (defensive) no recognizable suffix
//
// This helper parses that suffix back off so the dashboard can render the clean
// task title plus little source badges, instead of showing the raw suffix text.
// Parsing (rather than a new DB column) keeps every EXISTING ledger row — which
// already carries these suffixes on prod — rendering correctly with no
// migration; write-time formatting is unchanged.

export type EarningSourceKind = "manual" | "pre-assigned" | "label";

export interface EarningBadge {
  kind: EarningSourceKind;
  // Display text for the badge (the label name for `label`, else a fixed word).
  text: string;
}

export interface ParsedEarning {
  // The task title with the provenance suffix stripped off.
  title: string;
  badges: EarningBadge[];
}

const MANUAL_SUFFIX = " (manual review)";
const PREASSIGNED_SUFFIX = " (pre-assigned)";
// A trailing " [ ... ]" with no nested brackets — the label list appended by
// sync. Anchored to the end so brackets earlier in a title are left alone.
const LABEL_RE = /\s\[([^[\]]+)\]$/;

export function parseEarning(description: string | null): ParsedEarning {
  const raw = description ?? "";

  if (raw.endsWith(MANUAL_SUFFIX)) {
    return {
      title: raw.slice(0, -MANUAL_SUFFIX.length),
      badges: [{ kind: "manual", text: "manual review" }],
    };
  }

  if (raw.endsWith(PREASSIGNED_SUFFIX)) {
    return {
      title: raw.slice(0, -PREASSIGNED_SUFFIX.length),
      badges: [{ kind: "pre-assigned", text: "pre-assigned" }],
    };
  }

  const labelMatch = raw.match(LABEL_RE);
  if (labelMatch) {
    const labels = labelMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (labels.length > 0) {
      return {
        title: raw.slice(0, labelMatch.index),
        badges: labels.map((text) => ({ kind: "label", text })),
      };
    }
  }

  return { title: raw, badges: [] };
}
