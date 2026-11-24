"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SortableList from "../SortableList";
import { sortByDue } from "@/lib/dueOrder";
import { formatPoints } from "@/lib/points";

interface ReviewTask {
  completion_id: string;
  content: string;
  completed_at: string | null;
}

interface TodoistDue {
  date: string;
  datetime?: string | null;
  string?: string;
}

interface UpcomingTask {
  id: string;
  content: string;
  due: TodoistDue | null; // null: no due date, listed because points are set
  points: number | null; // points set ahead of time, null if none
}

// Prefer the natural-language string Todoist stored (e.g. "Nov 25"); fall back
// to the raw date, read as a LOCAL calendar date (a bare "YYYY-MM-DD" parsed by
// new Date() would be UTC midnight and show the previous day in the US).
function formatDue(due: TodoistDue): string {
  if (due.string) return due.string;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(due.date);
  if (!m) return due.date;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(
    undefined,
    { month: "short", day: "numeric" }
  );
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
  // "Discard all" two-step confirm (no native confirm()) + in-flight guard.
  // Arming the confirm snapshots the ids on screen; only those are discarded,
  // so anything auto-sync queues while the confirm is open survives.
  const [confirmingAll, setConfirmingAll] = useState<string[] | null>(null);
  const [discardingAll, setDiscardingAll] = useState(false);

  // "Reorder in flight" guard: while true, the sync-driven refetch skips the
  // list so an in-flight sync can't snap it back to the old order before the
  // reorder POST persists.
  const reorderingReview = useRef(false);

  // Assign/discard actions in flight, plus a counter bumped whenever one
  // starts or settles. A refetch whose response could predate a removal is
  // dropped rather than applied, so a just-removed row can't come back.
  // The last action to settle dispatches `todoist:synced`, which reloads once.
  const pendingActions = useRef(0);
  const actionGen = useRef(0);

  // Upcoming: open Todoist tasks with a due date + points set ahead of time.
  // Independent of the Completed list's state and its action guard above: its
  // saves/clears never touch `tasks`, pendingActions or actionGen.
  const [upcoming, setUpcoming] = useState<UpcomingTask[]>([]);
  const [upcomingInputs, setUpcomingInputs] = useState<Record<string, string>>({});
  const [upcomingBusy, setUpcomingBusy] = useState<Record<string, boolean>>({});
  const [upcomingLoading, setUpcomingLoading] = useState(true);
  const [upcomingError, setUpcomingError] = useState<string | null>(null);
  // Same stale-response guard as Completed, but separate counters: saves and
  // clears in flight, plus a generation bumped when one starts or settles. A
  // refetch that started before (or lands during) a save/clear is dropped, so
  // it can't show stale points or hide Clear. The last one to settle reloads.
  const pendingUpcoming = useRef(0);
  const upcomingGen = useRef(0);

  function beginAction() {
    pendingActions.current += 1;
    actionGen.current += 1;
  }

  function endAction() {
    pendingActions.current -= 1;
    actionGen.current += 1;
    if (pendingActions.current === 0) {
      // Refreshes this list, the nav badge and any other listener.
      window.dispatchEvent(new CustomEvent("todoist:synced"));
    }
  }

  const load = useCallback(async () => {
    const gen = actionGen.current;
    try {
      const res = await fetch("/api/review");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      if (pendingActions.current > 0 || gen !== actionGen.current) return;
      setTasks(data.tasks ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUpcoming = useCallback(async () => {
    const gen = upcomingGen.current;
    try {
      const res = await fetch("/api/upcoming");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load upcoming tasks");
      if (pendingUpcoming.current > 0 || gen !== upcomingGen.current) return;
      // Always by due date (the user's local day); not drag-reorderable.
      const list: UpcomingTask[] = sortByDue(data.tasks ?? []);
      setUpcoming(list);
      // Seed each input from its saved value so it re-displays on reload, but
      // never clobber an input the user is mid-edit on.
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
    // Refetch both lists when the global AutoSync reports new data — but skip
    // Completed while it's mid-reorder, so the sync can't clobber its
    // optimistic order before the reorder POST persists.
    const onSynced = () => {
      if (!reorderingReview.current) load();
      loadUpcoming();
    };
    window.addEventListener("todoist:synced", onSynced);
    return () => window.removeEventListener("todoist:synced", onSynced);
  }, [load, loadUpcoming]);

  function beginUpcomingAction() {
    pendingUpcoming.current += 1;
    upcomingGen.current += 1;
  }

  function endUpcomingAction() {
    pendingUpcoming.current -= 1;
    upcomingGen.current += 1;
    if (pendingUpcoming.current === 0) loadUpcoming();
  }

  async function saveUpcoming(task: UpcomingTask) {
    const raw = upcomingInputs[task.id] ?? "";
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isInteger(n) || n < 1 || n > 100000) {
      setUpcomingError(
        "Points must be a whole number from 1 to 100000 (use Clear to remove)."
      );
      return;
    }
    setUpcomingError(null);
    setUpcomingBusy((prev) => ({ ...prev, [task.id]: true }));
    beginUpcomingAction();
    try {
      const res = await fetch(`/api/upcoming/${encodeURIComponent(task.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: n, content: task.content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setUpcoming((prev) => prev.map((t) => (t.id === task.id ? { ...t, points: n } : t)));
    } catch (err) {
      setUpcomingError((err as Error).message);
    } finally {
      setUpcomingBusy((prev) => ({ ...prev, [task.id]: false }));
      endUpcomingAction();
    }
  }

  async function clearUpcoming(id: string) {
    setUpcomingError(null);
    setUpcomingBusy((prev) => ({ ...prev, [id]: true }));
    beginUpcomingAction();
    try {
      const res = await fetch(`/api/upcoming/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to clear");
      setUpcoming((prev) => prev.map((t) => (t.id === id ? { ...t, points: null } : t)));
      setUpcomingInputs((prev) => ({ ...prev, [id]: "" }));
    } catch (err) {
      setUpcomingError((err as Error).message);
    } finally {
      setUpcomingBusy((prev) => ({ ...prev, [id]: false }));
      endUpcomingAction();
    }
  }

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
    beginAction();
    try {
      const res = await fetch(`/api/review/${encodeURIComponent(id)}/award`, {
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
      endAction();
    }
  }

  async function discard(id: string) {
    setError(null);
    setBusy((prev) => ({ ...prev, [id]: true }));
    beginAction();
    try {
      const res = await fetch(`/api/review/${encodeURIComponent(id)}/discard`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to discard");
      setTasks((prev) => prev.filter((t) => t.completion_id !== id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy((prev) => ({ ...prev, [id]: false }));
      endAction();
    }
  }

  // The armed snapshot, minus anything assigned or discarded since it was
  // armed, so the confirm never counts (or sends) an item no longer on screen.
  const armedIds = confirmingAll?.filter((id) =>
    tasks.some((t) => t.completion_id === id)
  );

  // Don't leave a stale confirm armed if its items are all gone.
  useEffect(() => {
    if (armedIds?.length === 0) setConfirmingAll(null);
  }, [armedIds?.length]);

  async function discardAll(ids: string[]) {
    setError(null);
    setDiscardingAll(true);
    beginAction();
    try {
      const res = await fetch("/api/review/discard-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to discard all");
      setConfirmingAll(null);
      const discarded = new Set(ids);
      setTasks((prev) => prev.filter((t) => !discarded.has(t.completion_id)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDiscardingAll(false);
      endAction();
    }
  }

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Review</h1>
        {balance !== null && (
          <span className="whitespace-nowrap text-sm text-slate-400">
            Balance:{" "}
            <span
              className={`font-semibold ${balance < 0 ? "text-rose-400" : "text-emerald-400"}`}
            >
              {formatPoints(balance)}
            </span>{" "}
            pts
          </span>
        )}
      </div>

      {/* Completed: the review queue. "Discard all" belongs to this section
          only and only ever touches pending_review. */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Completed</h2>
          <div className="flex flex-wrap items-center gap-3">
            {tasks.length > 0 &&
              (armedIds && armedIds.length > 0 ? (
                <div className="flex items-center gap-2">
                  <span className="whitespace-nowrap text-sm text-slate-300">
                    Discard all {armedIds.length}?
                  </span>
                  <button
                    onClick={() => discardAll(armedIds)}
                    disabled={discardingAll}
                    className="shrink-0 whitespace-nowrap rounded-md border border-rose-900 px-3 py-2 text-xs text-rose-400 hover:bg-rose-950 disabled:opacity-40 sm:py-1.5"
                  >
                    {discardingAll ? "Discarding…" : "Confirm"}
                  </button>
                  <button
                    onClick={() => setConfirmingAll(null)}
                    disabled={discardingAll}
                    className="shrink-0 whitespace-nowrap rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40 sm:py-1.5"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() =>
                    setConfirmingAll(tasks.map((t) => t.completion_id))
                  }
                  className="shrink-0 whitespace-nowrap rounded-md border border-rose-900 px-3 py-2 text-xs text-rose-400 hover:bg-rose-950 sm:py-1.5"
                >
                  Discard all ({tasks.length})
                </button>
              ))}
          </div>
        </div>

        <p className="text-sm text-slate-400">
          Tasks you complete in Todoist land here, unless you set their points
          ahead of time under Upcoming. Assign each one a point value, or discard
          it (entering 0 also discards). Discarded tasks won’t come back.
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
      </section>

      {/* Upcoming: open Todoist tasks with a due date. Points saved here are
          paid out automatically when the task is completed. */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold">Upcoming</h2>
        <p className="text-sm text-slate-400">
          Open Todoist tasks with a due date (and any open task you’ve already
          set points for). Set points ahead of time and
          they’re paid out automatically when you complete the task — it skips
          the Completed list. Use Clear to remove the points.
        </p>

        {upcomingLoading && <p className="text-slate-500">Loading…</p>}
        {upcomingError && <p className="text-rose-400">{upcomingError}</p>}

        {!upcomingLoading && upcoming.length === 0 && !upcomingError && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-10 text-center text-sm text-slate-400">
            No open tasks with a due date.
          </div>
        )}

        {upcoming.length > 0 && (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
            {upcoming.map((t) => (
              <li key={t.id} className="px-4 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-w-0 sm:flex-1">
                    <div className="break-words text-sm text-slate-100">{t.content}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {t.due ? (
                        <span className="whitespace-nowrap rounded-full border border-emerald-900 bg-emerald-950/40 px-2 py-0.5 text-xs text-emerald-300">
                          Due {formatDue(t.due)}
                        </span>
                      ) : (
                        <span className="whitespace-nowrap rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                          No due date
                        </span>
                      )}
                      {t.points != null && (
                        <span className="whitespace-nowrap text-xs font-medium text-emerald-400">
                          Set: {t.points} pts
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:shrink-0">
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      placeholder="pts"
                      aria-label={`Points for ${t.content}`}
                      value={upcomingInputs[t.id] ?? ""}
                      onChange={(e) =>
                        setUpcomingInputs((prev) => ({ ...prev, [t.id]: e.target.value }))
                      }
                      disabled={upcomingBusy[t.id]}
                      className="w-24 shrink-0 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-right text-base text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50 sm:w-20 sm:text-sm"
                    />
                    <button
                      onClick={() => saveUpcoming(t)}
                      disabled={upcomingBusy[t.id]}
                      className="shrink-0 whitespace-nowrap rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 sm:py-1.5"
                    >
                      Save
                    </button>
                    {t.points != null && (
                      <button
                        onClick={() => clearUpcoming(t.id)}
                        disabled={upcomingBusy[t.id]}
                        className="shrink-0 whitespace-nowrap rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40 sm:py-1.5"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
