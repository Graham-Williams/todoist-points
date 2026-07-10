"use client";

import { useCallback, useEffect, useState } from "react";
import SortableList from "../SortableList";

interface ReviewTask {
  completion_id: string;
  content: string;
  labels: string[];
  completed_at: string | null;
}

interface TodoistDue {
  date: string;
  string?: string;
  is_recurring?: boolean;
}

interface UpcomingTask {
  id: string;
  content: string;
  labels: string[];
  due: TodoistDue;
  points: number | null; // saved override, null if none
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

// Prefer the natural-language string Todoist stored (e.g. "Jul 8"); fall back to
// formatting the raw date (avoids the UTC-midnight off-by-one on bare dates).
function formatDue(due: TodoistDue): string {
  if (due.string) return due.string;
  return formatDate(due.date);
}

export default function ReviewPage() {
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [points, setPoints] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  // Upcoming (uncompleted, dated) tasks + their manual point pre-assignments.
  const [upcoming, setUpcoming] = useState<UpcomingTask[]>([]);
  const [upcomingInputs, setUpcomingInputs] = useState<Record<string, string>>(
    {}
  );
  const [upcomingBusy, setUpcomingBusy] = useState<Record<string, boolean>>({});
  const [upcomingLoading, setUpcomingLoading] = useState(true);
  const [upcomingError, setUpcomingError] = useState<string | null>(null);

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

  const loadUpcoming = useCallback(async () => {
    try {
      const res = await fetch("/api/upcoming");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load upcoming");
      const list: UpcomingTask[] = data.tasks ?? [];
      setUpcoming(list);
      // Seed each input from its saved override so values re-display on reload.
      // Don't clobber an input the user is mid-edit on.
      setUpcomingInputs((prev) => {
        const next = { ...prev };
        for (const t of list) {
          if (next[t.id] === undefined) {
            next[t.id] = t.points != null ? String(t.points) : "";
          }
        }
        return next;
      });
      setUpcomingError(null);
    } catch (err) {
      setUpcomingError((err as Error).message);
    } finally {
      setUpcomingLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadUpcoming();
    // Refetch both lists when the global AutoSync reports new data.
    const onSynced = () => {
      load();
      loadUpcoming();
    };
    window.addEventListener("todoist:synced", onSynced);
    return () => window.removeEventListener("todoist:synced", onSynced);
  }, [load, loadUpcoming]);

  // Persist a new drag order for the review queue: optimistic, reload-on-failure.
  async function reorderReview(newItems: ReviewTask[]) {
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
    }
  }

  // Persist a new drag order for the upcoming list.
  async function reorderUpcoming(newItems: UpcomingTask[]) {
    setUpcoming(newItems);
    try {
      const res = await fetch("/api/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          list: "upcoming",
          order: newItems.map((t) => t.id),
        }),
      });
      if (!res.ok) throw new Error("Failed to save order");
    } catch (err) {
      setUpcomingError((err as Error).message);
      loadUpcoming();
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

  function setUpcomingInput(id: string, value: string) {
    setUpcomingInputs((prev) => ({ ...prev, [id]: value }));
  }

  async function saveOverride(task: UpcomingTask) {
    const raw = upcomingInputs[task.id] ?? "";
    const n = parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 1 || n > 100000) {
      setUpcomingError(
        "Points must be a whole number between 1 and 100000 (use Clear to remove)."
      );
      return;
    }
    setUpcomingError(null);
    setUpcomingBusy((prev) => ({ ...prev, [task.id]: true }));
    try {
      const res = await fetch(`/api/upcoming/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: n, content: task.content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setUpcoming((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, points: n } : t))
      );
    } catch (err) {
      setUpcomingError((err as Error).message);
    } finally {
      setUpcomingBusy((prev) => ({ ...prev, [task.id]: false }));
    }
  }

  async function clearOverride(id: string) {
    setUpcomingError(null);
    setUpcomingBusy((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/upcoming/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to clear");
      setUpcoming((prev) =>
        prev.map((t) => (t.id === id ? { ...t, points: null } : t))
      );
      setUpcomingInputs((prev) => ({ ...prev, [id]: "" }));
    } catch (err) {
      setUpcomingError((err as Error).message);
    } finally {
      setUpcomingBusy((prev) => ({ ...prev, [id]: false }));
    }
  }

  return (
    <div className="space-y-10">
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
          <SortableList
            items={tasks}
            getKey={(t) => t.completion_id}
            onReorder={reorderReview}
            ulClassName="divide-y divide-slate-800 rounded-xl border border-slate-800"
            liClassName="px-4 py-3"
            renderItem={(t) => (
              <div className="flex flex-wrap items-center justify-between gap-4">
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
              </div>
            )}
          />
        )}
      </div>

      {/* Upcoming: pre-assign a point value to uncompleted, dated tasks. The
          saved value is awarded (overriding label points) when the task is
          completed. */}
      <div className="space-y-6">
        <h2 className="text-xl font-bold">Upcoming</h2>
        <p className="text-sm text-slate-400">
          Uncompleted tasks with a due date. Pre-assign a point value and it’s
          remembered — when the task is completed it awards exactly that,{" "}
          <span className="text-slate-300">overriding</span> its label points.
          Use Clear to fall back to label-based points.
        </p>

        {upcomingLoading && <p className="text-slate-500">Loading…</p>}
        {upcomingError && <p className="text-rose-400">{upcomingError}</p>}

        {!upcomingLoading && upcoming.length === 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-10 text-center text-sm text-slate-400">
            No upcoming dated tasks.
          </div>
        )}

        {upcoming.length > 0 && (
          <SortableList
            items={upcoming}
            getKey={(t) => t.id}
            onReorder={reorderUpcoming}
            ulClassName="divide-y divide-slate-800 rounded-xl border border-slate-800"
            liClassName="px-4 py-3"
            renderItem={(t) => (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-100">
                    {t.content}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-emerald-900 bg-emerald-950/40 px-2 py-0.5 text-xs text-emerald-300">
                      Due {formatDue(t.due)}
                    </span>
                    {t.labels.map((label) => (
                      <span
                        key={label}
                        className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-300"
                      >
                        {label}
                      </span>
                    ))}
                    {t.points != null && (
                      <span className="text-xs font-medium text-emerald-400">
                        Pre-assigned: {t.points} pts
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    placeholder="pts"
                    value={upcomingInputs[t.id] ?? ""}
                    onChange={(e) => setUpcomingInput(t.id, e.target.value)}
                    disabled={upcomingBusy[t.id]}
                    className="w-20 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-right text-sm text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                  />
                  <button
                    onClick={() => saveOverride(t)}
                    disabled={upcomingBusy[t.id]}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                  >
                    Save
                  </button>
                  {t.points != null && (
                    <button
                      onClick={() => clearOverride(t.id)}
                      disabled={upcomingBusy[t.id]}
                      className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
}
