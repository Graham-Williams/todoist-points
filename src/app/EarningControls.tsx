"use client";

import { useState } from "react";

// Per-earning control cluster on the dashboard "Recent earnings" list. Combines
// two inline actions on each row (Edit · Remove), each unobtrusive until clicked:
//
//  - Edit: reveals a number input pre-filled with the current points + Save /
//    Cancel (mirrors the /rewards inline-cost edit). Client-validates an integer
//    >= 1 (Save disabled otherwise), PATCHes /api/ledger/<id>, then dispatches the
//    global `todoist:synced` event so DashboardRefresh re-runs getStats()
//    (balance + list update via the existing machinery). Editing points touches
//    ONLY the ledger row, never processed_completions, so sync never re-awards.
//  - Remove: two-step confirm (Remove? → Confirm / Cancel; no native confirm()),
//    DELETEs /api/ledger/<id>, then dispatches `todoist:synced`. Deleting the
//    ledger row leaves processed_completions intact, so the removed earning is
//    never re-awarded on the next sync.
//
// Both actions can never edit/delete a `redeem` row — the route + queries guard
// on type = 'earn'.
export default function EarningControls({
  id,
  points,
}: {
  id: number;
  points: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(points));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draftValid = (() => {
    const n = parseInt(draft, 10);
    return Number.isInteger(n) && n >= 1 && n <= 100000;
  })();

  function startEdit() {
    setError(null);
    setConfirming(false);
    setDraft(String(points));
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft(String(points));
  }

  async function save() {
    const n = parseInt(draft, 10);
    if (!Number.isInteger(n) || n < 1 || n > 100000) {
      setError("Enter a whole number between 1 and 100000");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/ledger/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: n }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to update");
        setBusy(false);
        return;
      }
      // Reuse the global refresh machinery to update balance + list. The
      // component unmounts on refresh; no need to reset local state.
      window.dispatchEvent(new CustomEvent("todoist:synced"));
    } catch {
      setError("Failed to update");
      setBusy(false);
    }
  }

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
      window.dispatchEvent(new CustomEvent("todoist:synced"));
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
            setEditing(false);
            setConfirming(false);
          }}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <input
          type="number"
          min={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          className="w-20 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-right text-xs text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />
        <span className="text-xs text-slate-400">pts</span>
        <button
          onClick={save}
          disabled={busy || !draftValid}
          className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          onClick={cancelEdit}
          disabled={busy}
          className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
        >
          Cancel
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
    <div className="flex shrink-0 items-center gap-2 text-xs text-slate-600">
      <button onClick={startEdit} className="hover:text-emerald-400">
        Edit
      </button>
      <span aria-hidden className="text-slate-700">
        ·
      </span>
      <button
        onClick={() => setConfirming(true)}
        aria-label="Remove earning"
        className="hover:text-rose-400"
      >
        Remove
      </button>
    </div>
  );
}
