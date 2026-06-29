"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

// Auto-sync interval: poll Todoist completions every 3 minutes while the app is open.
const SYNC_INTERVAL_MS = 3 * 60 * 1000;
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
  const router = useRouter();
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
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [router]);

  // Sync once on mount, then on a fixed interval while the app is open.
  useEffect(() => {
    void sync();
    const id = setInterval(() => void sync(), SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sync]);

  // Keep the relative "last synced" label fresh without a full sync.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  let status: string;
  if (busy) status = "Syncing…";
  else if (error) status = error;
  else if (lastSynced) status = `Last synced: ${relativeTime(lastSynced, now)}`;
  else status = "Not synced yet";

  return (
    <div className="flex items-center gap-3">
      <span className={`text-sm ${error ? "text-rose-400" : "text-slate-400"}`}>
        {status}
      </span>
      <button
        onClick={() => void sync()}
        disabled={busy}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
