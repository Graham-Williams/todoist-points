"use client";

import { useState } from "react";

const MAX = 1000000;

// The dashboard Balance card, with a small "Adjust" control: an inline number
// input prefilled with the current balance + Save/Cancel, plus a "Reset to 0"
// shortcut behind a two-step confirm (no native confirm()). Both POST
// /api/balance, which records the difference as a balance adjustment, then
// dispatch `todoist:synced` so DashboardRefresh re-runs getStats().
export default function BalanceCard({ balance }: { balance: number }) {
  const [mode, setMode] = useState<"idle" | "edit" | "confirmReset">("idle");
  const [draft, setDraft] = useState(String(balance));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = Number(draft);
  const draftValid =
    draft.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= MAX;

  function startEdit() {
    setError(null);
    setDraft(String(balance));
    setMode("edit");
  }

  async function submit(target: number) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ balance: target }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to set balance");
      setMode("idle");
      window.dispatchEvent(new CustomEvent("todoist:synced"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-slate-400">Balance</div>
        {mode === "idle" && (
          <button
            onClick={startEdit}
            className="text-xs text-slate-500 hover:text-emerald-400"
          >
            Adjust
          </button>
        )}
      </div>
      <div className="mt-1 text-3xl font-bold text-emerald-400">{balance}</div>

      {mode === "edit" && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={0}
              max={MAX}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
              aria-label="New balance"
              className="w-28 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-right text-base text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50 sm:text-xs"
            />
            <button
              onClick={() => submit(n)}
              disabled={busy || !draftValid}
              className="rounded-md bg-emerald-600 px-2.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 sm:py-1"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setMode("idle")}
              disabled={busy}
              className="rounded-md border border-slate-700 px-2.5 py-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40 sm:py-1"
            >
              Cancel
            </button>
          </div>
          <button
            onClick={() => setMode("confirmReset")}
            disabled={busy}
            className="text-xs text-rose-400 hover:text-rose-300 disabled:opacity-40"
          >
            Reset to 0
          </button>
        </div>
      )}

      {mode === "confirmReset" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-300">Reset balance to 0?</span>
          <button
            onClick={() => submit(0)}
            disabled={busy}
            className="rounded-md border border-rose-900 px-2.5 py-2 text-xs text-rose-400 hover:bg-rose-950 disabled:opacity-40 sm:py-1"
          >
            {busy ? "Resetting…" : "Confirm"}
          </button>
          <button
            onClick={() => setMode("idle")}
            disabled={busy}
            className="rounded-md border border-slate-700 px-2.5 py-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40 sm:py-1"
          >
            Cancel
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </div>
  );
}
