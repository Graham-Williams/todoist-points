"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SortableList from "../SortableList";

interface LabelRow {
  name: string;
  color: string | null;
  points: number;
}

export default function LabelsPage() {
  const [labels, setLabels] = useState<LabelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // True while a reorder is optimistically applied but not yet persisted — the
  // sync-driven refetch skips this list so it can't snap back the old order (and,
  // importantly for this page, can't wipe in-progress point-input edits).
  const reordering = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/labels");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load labels");
      setLabels(data.labels);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Refetch when the global AutoSync reports new data — but not mid-reorder.
    const onSynced = () => {
      if (!reordering.current) load();
    };
    window.addEventListener("todoist:synced", onSynced);
    return () => window.removeEventListener("todoist:synced", onSynced);
  }, [load]);

  function setPoints(name: string, value: string) {
    const n = value === "" ? 0 : parseInt(value, 10);
    setLabels((prev) =>
      prev.map((l) => (l.name === name ? { ...l, points: Number.isNaN(n) ? 0 : n } : l))
    );
  }

  // Persist a new drag order (independent of the batch "Save points" button —
  // reorder saves immediately on drop). Optimistic, with reload-on-failure.
  async function reorder(newItems: LabelRow[]) {
    reordering.current = true;
    setLabels(newItems);
    try {
      const res = await fetch("/api/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          list: "labels",
          order: newItems.map((l) => l.name),
        }),
      });
      if (!res.ok) throw new Error("Failed to save order");
      // Success: keep the optimistic state as-is. Do NOT reload — the rows hold
      // unsaved point-input values that a reload would wipe. The new order is
      // already correct and persisted.
    } catch (err) {
      setError((err as Error).message);
      load();
    } finally {
      reordering.current = false;
    }
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const points: Record<string, number> = {};
      for (const l of labels) points[l.name] = l.points;
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setStatus("Saved.");
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Labels &amp; Points</h1>
        <div className="flex items-center gap-3">
          {status && <span className="text-sm text-slate-400">{status}</span>}
          <button
            onClick={save}
            disabled={saving || loading}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save points"}
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-400">
        Assign a point value to each Todoist label. Completing a task awards the
        sum of its labels’ values. Unset labels default to 0.
      </p>

      {loading && <p className="text-slate-500">Loading labels…</p>}
      {error && <p className="text-rose-400">{error}</p>}

      {!loading && !error && labels.length === 0 && (
        <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
          <li className="px-4 py-3 text-sm text-slate-500">No labels found.</li>
        </ul>
      )}

      {!loading && !error && labels.length > 0 && (
        <SortableList
          items={labels}
          getKey={(l) => l.name}
          onReorder={reorder}
          ulClassName="divide-y divide-slate-800 rounded-xl border border-slate-800"
          liClassName="px-4 py-3"
          renderItem={(l) => (
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-slate-200">{l.name}</span>
              <input
                type="number"
                value={l.points}
                onChange={(e) => setPoints(l.name, e.target.value)}
                className="w-24 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-right text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          )}
        />
      )}
    </div>
  );
}
