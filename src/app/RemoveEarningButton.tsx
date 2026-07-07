"use client";

import { useState } from "react";

// Per-earning remove control on the dashboard "Recent earnings" list. Inline
// two-step confirm (matches the rewards inline-edit idiom; no native confirm()):
// a small "Remove" button reveals "Remove? Confirm / Cancel". On confirm it
// DELETEs /api/ledger/<id>, then dispatches the global `todoist:synced` event so
// DashboardRefresh re-runs getStats() (balance + list update via existing
// machinery). Deleting the ledger row leaves processed_completions intact, so
// the removed earning is never re-awarded on the next sync.
export default function RemoveEarningButton({ id }: { id: number }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/ledger/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to remove");
        setBusy(false);
        return;
      }
      // Reuse the global refresh machinery to update balance + list.
      window.dispatchEvent(new CustomEvent("todoist:synced"));
      // Component unmounts on refresh; no need to reset local state.
    } catch {
      setError("Failed to remove");
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-rose-400">{error}</span>
        <button
          onClick={() => {
            setError(null);
            setConfirming(false);
          }}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-slate-400">Remove?</span>
        <button
          onClick={remove}
          disabled={busy}
          className="rounded-md border border-rose-900 px-2.5 py-1 text-xs text-rose-400 hover:bg-rose-950 disabled:opacity-40"
        >
          {busy ? "Removing…" : "Confirm"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      aria-label="Remove earning"
      className="shrink-0 text-xs text-slate-600 hover:text-rose-400"
    >
      Remove
    </button>
  );
}
