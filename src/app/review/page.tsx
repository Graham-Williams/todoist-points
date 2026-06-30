"use client";

import { useCallback, useEffect, useState } from "react";

interface ReviewTask {
  completion_id: string;
  content: string;
  labels: string[];
  completed_at: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ReviewPage() {
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [points, setPoints] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/review");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setTasks(data.tasks ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Refetch the pending queue when the global AutoSync reports new data.
    const onSynced = () => load();
    window.addEventListener("todoist:synced", onSynced);
    return () => window.removeEventListener("todoist:synced", onSynced);
  }, [load]);

  function setPointValue(id: string, value: string) {
    setPoints((prev) => ({ ...prev, [id]: value }));
  }

  async function award(id: string) {
    const raw = points[id] ?? "1";
    const n = parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 0) {
      setError("Points must be a whole number of 0 or more (0 = discard).");
      return;
    }
    setError(null);
    setBusy((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/review/${id}/award`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: n }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to assign points");
      setBalance(data.newBalance ?? null);
      setTasks((prev) => prev.filter((t) => t.completion_id !== id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function discard(id: string) {
    setError(null);
    setBusy((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/review/${id}/discard`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to discard");
      setTasks((prev) => prev.filter((t) => t.completion_id !== id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy((prev) => ({ ...prev, [id]: false }));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Review</h1>
        {balance !== null && (
          <span className="text-sm text-slate-400">
            Balance:{" "}
            <span className="font-semibold text-emerald-400">{balance}</span>{" "}
            pts
          </span>
        )}
      </div>

      <p className="text-sm text-slate-400">
        Completed tasks that earned no points — assign a value or discard.
        Enter 0 to discard. Discarded tasks won’t come back.
      </p>

      {loading && <p className="text-slate-500">Loading…</p>}
      {error && <p className="text-rose-400">{error}</p>}

      {!loading && tasks.length === 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-10 text-center text-sm text-slate-400">
          Nothing to review 🎉
        </div>
      )}

      {tasks.length > 0 && (
        <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
          {tasks.map((t) => (
            <li
              key={t.completion_id}
              className="flex flex-wrap items-center justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-100">
                  {t.content}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {t.labels.map((label) => (
                    <span
                      key={label}
                      className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-300"
                    >
                      {label}
                    </span>
                  ))}
                  {t.completed_at && (
                    <span className="text-xs text-slate-500">
                      {formatDate(t.completed_at)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-slate-500">0 = discard</span>
                <input
                  type="number"
                  min={0}
                  title="0 = discard"
                  value={points[t.completion_id] ?? "1"}
                  onChange={(e) =>
                    setPointValue(t.completion_id, e.target.value)
                  }
                  disabled={busy[t.completion_id]}
                  className="w-20 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-right text-sm text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                />
                <button
                  onClick={() => award(t.completion_id)}
                  disabled={busy[t.completion_id]}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                >
                  Assign
                </button>
                <button
                  onClick={() => discard(t.completion_id)}
                  disabled={busy[t.completion_id]}
                  className="rounded-md border border-rose-900 px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-950 disabled:opacity-40"
                >
                  Discard
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
