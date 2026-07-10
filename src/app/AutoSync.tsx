"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Auto-sync interval: poll Todoist completions every 15 seconds while the tab is
// active (paused when the tab is hidden — see visibility handling below).
const SYNC_INTERVAL_MS = 15 * 1000;
// How often to re-render the "last synced" relative time so it stays fresh.
const CLOCK_TICK_MS = 15 * 1000;

function relativeTime(from: number, now: number): string {
  const secs = Math.max(0, Math.round((now - from) / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

export default function AutoSync() {
  const [busy, setBusy] = useState(false);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Guard against overlapping syncs (e.g. interval firing while one is in flight).
  const inFlight = useRef(false);

  const sync = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setLastSynced(Date.now());
      // Notify every view to refetch its data. A single global AutoSync (in the
      // layout header) drives all pages via this event — see DashboardRefresh,
      // the labels/rewards/review pages, and ReviewNavLink.
      window.dispatchEvent(new CustomEvent("todoist:synced"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  // Sync once on mount, then on a fixed interval — but only while the tab is
  // visible, and immediately when the tab regains focus. Keeps points fresh
  // without burning API calls in a backgrounded tab.
  useEffect(() => {
    void sync();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void sync();
    }, SYNC_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sync]);

  // Keep the relative "last synced" label fresh without a full sync.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  let status: string;
  if (busy) status = "Syncing…";
  else if (error) status = error;
  else if (lastSynced) status = `Synced ${relativeTime(lastSynced, now)}`;
  else status = "Not synced yet";

  return (
    <div className="flex shrink-0 items-center gap-3">
      {/* The status text only shows on wide screens (lg+); below that the nav
          collapses to a hamburger and just the Sync button remains. nowrap so
          "Synced just now" never breaks across lines. */}
      <span
        className={`hidden whitespace-nowrap text-sm lg:inline ${
          error ? "text-rose-400" : "text-slate-500"
        }`}
      >
        {status}
      </span>
      <button
        onClick={() => void sync()}
        disabled={busy}
        className="shrink-0 whitespace-nowrap rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
