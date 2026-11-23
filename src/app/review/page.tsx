"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SortableList from "../SortableList";

interface ReviewTask {
  completion_id: string;
  content: string;
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

  // "Reorder in flight" guard: while true, the sync-driven refetch skips the
  // list so an in-flight sync can't snap it back to the old order before the
  // reorder POST persists.
  const reorderingReview = useRef(false);

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
    // Refetch when the global AutoSync reports new data — but not mid-reorder,
    // so the sync can't clobber the optimistic order before it persists.
    const onSynced = () => {
      if (!reorderingReview.current) load();
    };
    window.addEventListener("todoist:synced", onSynced);
    return () => window.removeEventListener("todoist:synced", onSynced);
  }, [load]);

  // Persist a new drag order for the review queue: optimistic, reload-on-failure.
  async function reorderReview(newItems: ReviewTask[]) {
    reorderingReview.current = true;
    setTasks(newItems);
    try {
      const res = await fetch("/api/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          list: "review",
          order: newItems.map((t) => t.completion_id),
        }),
      });
      if (!res.ok) throw new Error("Failed to save order");
    } catch (err) {
      setError((err as Error).message);
      load();
    } finally {
      reorderingReview.current = false;
    }
  }

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
        Tasks you complete in Todoist land here. Assign each one a point
        value, or discard it (entering 0 also discards). Discarded tasks won’t
        come back.
      </p>

      {loading && <p className="text-slate-500">Loading…</p>}
      {error && <p className="text-rose-400">{error}</p>}

      {!loading && tasks.length === 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-10 text-center text-sm text-slate-400">
          Nothing to review 🎉
        </div>
      )}

      {tasks.length > 0 && (
        <SortableList
          items={tasks}
          getKey={(t) => t.completion_id}
          onReorder={reorderReview}
          ulClassName="divide-y divide-slate-800 rounded-xl border border-slate-800"
          liClassName="px-4 py-3"
          renderItem={(t) => (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0 sm:flex-1">
                <div className="break-words text-sm text-slate-100">
                  {t.content}
                </div>
                {t.completed_at && (
                  <div className="mt-1 whitespace-nowrap text-xs text-slate-500">
                    {formatDate(t.completed_at)}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 sm:shrink-0">
                {/* The intro paragraph already says "Enter 0 to discard", so
                    drop the inline hint on narrow screens where it would
                    steal width from the controls. */}
                <span className="hidden text-xs text-slate-500 sm:inline">
                  0 = discard
                </span>
                <input
                  type="number"
                  min={0}
                  title="0 = discard"
                  value={points[t.completion_id] ?? "1"}
                  onChange={(e) =>
                    setPointValue(t.completion_id, e.target.value)
                  }
                  disabled={busy[t.completion_id]}
                  className="w-24 shrink-0 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-right text-base text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50 sm:w-20 sm:text-sm"
                />
                <button
                  onClick={() => award(t.completion_id)}
                  disabled={busy[t.completion_id]}
                  className="shrink-0 whitespace-nowrap rounded-md bg-emerald-600 px-3 py-2 text-xs sm:py-1.5 font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                >
                  Assign
                </button>
                <button
                  onClick={() => discard(t.completion_id)}
                  disabled={busy[t.completion_id]}
                  className="shrink-0 whitespace-nowrap rounded-md border border-rose-900 px-3 py-2 text-xs sm:py-1.5 text-rose-400 hover:bg-rose-950 disabled:opacity-40"
                >
                  Discard
                </button>
              </div>
            </div>
          )}
        />
      )}
    </div>
  );
}
