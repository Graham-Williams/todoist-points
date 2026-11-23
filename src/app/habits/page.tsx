"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SortableList from "../SortableList";
import { lastNLocalDates, localDateStr } from "@/lib/dates";

interface Habit {
  id: number;
  name: string;
  points: number;
}

interface HabitWeek {
  habits: Habit[];
  checks: { habit_id: number; date: string }[];
  bonuses: { date: string; points: number | null }[];
  bonusPoints: number;
}

const DAYS = 7;
const checkKey = (habitId: number, date: string) => `${habitId}|${date}`;

// "Mon" / "23" for a local YYYY-MM-DD date.
function dayLabel(date: string): { weekday: string; day: number } {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
  });
  return { weekday, day: d };
}

// Cell + header widths must match so the day columns line up. Every row (and
// the header and bonus rows) ends in a right-aligned cluster of day cells with
// the same right padding, so columns align whatever the name column does. On
// phones the name sits on its own line above the cells (the stacked-row
// convention), leaving the full width for 7 large tap targets (7 x 40px + gaps
// fits a 390px screen without horizontal scroll).
const CELL = "h-10 w-10";
const CELL_W = "w-10";
const CELLS_GAP = "gap-1 sm:gap-1.5";
const ROW_PX = "px-2 sm:px-3";

export default function HabitsPage() {
  // Filled on the client in load(): this page is prerendered, so computing
  // "today" during render would bake in the build machine's date.
  const [days, setDays] = useState<string[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [checks, setChecks] = useState<Set<string>>(new Set());
  const [bonuses, setBonuses] = useState<Map<string, number | null>>(new Map());
  const [bonusPoints, setBonusPoints] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add form.
  const [name, setName] = useState("");
  const [points, setPoints] = useState("5");
  const [adding, setAdding] = useState(false);

  // Remove (two-step confirm) and bonus edit.
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const [editingBonus, setEditingBonus] = useState(false);
  const [bonusDraft, setBonusDraft] = useState("");
  const [savingBonus, setSavingBonus] = useState(false);

  // Toggles are optimistic. While any is in flight, sync-driven reloads are
  // held back (they could briefly revert a cell whose PUT hasn't landed); the
  // last toggle to finish dispatches `todoist:synced`, which reloads once.
  const pendingToggles = useRef(0);
  const reordering = useRef(false);

  const load = useCallback(async () => {
    // Recompute the 7 local days on every load so the grid rolls over at
    // local midnight on the next sync.
    const range = lastNLocalDates(new Date(), DAYS);
    try {
      const res = await fetch(
        `/api/habits?from=${range[0]}&to=${range[range.length - 1]}`
      );
      const data = (await res.json()) as HabitWeek & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load habits");
      if (pendingToggles.current > 0) return; // a toggle started meanwhile
      setDays(range);
      setHabits(data.habits);
      setChecks(new Set(data.checks.map((c) => checkKey(c.habit_id, c.date))));
      setBonuses(new Map(data.bonuses.map((b) => [b.date, b.points])));
      setBonusPoints(data.bonusPoints);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const onSynced = () => {
      if (pendingToggles.current === 0 && !reordering.current) load();
    };
    window.addEventListener("todoist:synced", onSynced);
    return () => window.removeEventListener("todoist:synced", onSynced);
  }, [load]);

  async function toggle(habit: Habit, date: string) {
    const key = checkKey(habit.id, date);
    const wasDone = checks.has(key);
    const flip = (done: boolean) =>
      setChecks((prev) => {
        const next = new Set(prev);
        if (done) next.add(key);
        else next.delete(key);
        return next;
      });
    flip(!wasDone);
    setError(null);
    pendingToggles.current += 1;
    try {
      const res = await fetch(`/api/habits/${habit.id}/checks/${date}`, {
        method: wasDone ? "DELETE" : "PUT",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to update habit");
    } catch (err) {
      flip(wasDone); // revert
      setError((err as Error).message);
    } finally {
      pendingToggles.current -= 1;
      if (pendingToggles.current === 0) {
        // Refresh this grid (bonus row) and the balance everywhere else.
        window.dispatchEvent(new CustomEvent("todoist:synced"));
      }
    }
  }

  async function addHabit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number(points);
    if (!name.trim() || !Number.isInteger(n) || n < 1 || n > 100000) {
      setError("Enter a name and a whole number of points (1–100000).");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/habits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, points: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to add habit");
      setName("");
      setPoints("5");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function removeHabit(id: number) {
    setError(null);
    setRemoving(true);
    try {
      const res = await fetch(`/api/habits/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to remove habit");
      setConfirmRemove(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRemoving(false);
    }
  }

  async function saveBonus() {
    const n = Number(bonusDraft);
    if (bonusDraft.trim() === "" || !Number.isInteger(n) || n < 0 || n > 100000) {
      setError("Bonus must be a whole number from 0 to 100000.");
      return;
    }
    setError(null);
    setSavingBonus(true);
    try {
      const res = await fetch("/api/habits/bonus", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to save bonus");
      setBonusPoints(data.bonusPoints);
      setEditingBonus(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingBonus(false);
    }
  }

  async function reorder(newItems: Habit[]) {
    reordering.current = true;
    setHabits(newItems);
    try {
      const res = await fetch("/api/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          list: "habits",
          order: newItems.map((h) => String(h.id)),
        }),
      });
      if (!res.ok) throw new Error("Failed to save order");
    } catch (err) {
      setError((err as Error).message);
      load();
    } finally {
      reordering.current = false;
    }
  }

  const today = localDateStr(new Date());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Habits</h1>
        {editingBonus ? (
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap text-sm text-slate-400">
              All-habits bonus:
            </span>
            <input
              type="number"
              min={0}
              value={bonusDraft}
              onChange={(e) => setBonusDraft(e.target.value)}
              disabled={savingBonus}
              aria-label="All-habits bonus points"
              className="w-20 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-right text-base text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50 sm:text-xs"
            />
            <button
              onClick={saveBonus}
              disabled={savingBonus}
              className="rounded-md bg-emerald-600 px-2.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 sm:py-1"
            >
              {savingBonus ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditingBonus(false)}
              disabled={savingBonus}
              className="rounded-md border border-slate-700 px-2.5 py-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40 sm:py-1"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span className="whitespace-nowrap">
              All-habits bonus:{" "}
              <span className="font-semibold text-amber-300">
                {bonusPoints} pts
              </span>
            </span>
            <button
              onClick={() => {
                setBonusDraft(String(bonusPoints));
                setEditingBonus(true);
              }}
              className="text-xs text-slate-500 hover:text-emerald-400"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      <p className="text-sm text-slate-400">
        Tick off a habit each day you do it to earn its points. Finish every
        habit in a day to earn the bonus too{bonusPoints === 0 ? " (currently off)" : ""}.
      </p>

      {loading && <p className="text-slate-500">Loading…</p>}
      {error && <p className="text-rose-400">{error}</p>}

      {!loading && habits.length === 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-10 text-center text-sm text-slate-400">
          No habits yet. Add something you want to do every day — say, a
          stretch or ten minutes of reading — and tick it off here to earn its
          points.
        </div>
      )}

      {habits.length > 0 && (
        // overflow-x-auto is only a safety net for very narrow screens; at 390px
        // the stacked layout fits without scrolling.
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <div>
            {/* Day header: same right-aligned cell cluster as the rows. */}
            <div className={`flex items-end justify-end gap-2 border-b border-slate-800 py-2 ${ROW_PX}`}>
              <div className="hidden min-w-0 flex-1 text-xs text-slate-500 sm:block">
                Habit
              </div>
              <div className={`flex shrink-0 ${CELLS_GAP}`}>
                {days.map((d) => {
                  const { weekday, day } = dayLabel(d);
                  const isToday = d === today;
                  return (
                    <div
                      key={d}
                      className={`${CELL_W} text-center text-[11px] leading-tight sm:text-xs ${
                        isToday ? "font-semibold text-emerald-400" : "text-slate-500"
                      }`}
                    >
                      <div>{weekday}</div>
                      <div>{day}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <SortableList
              items={habits}
              getKey={(h) => String(h.id)}
              onReorder={reorder}
              ulClassName="divide-y divide-slate-800"
              liClassName={`py-2 ${ROW_PX}`}
              renderItem={(h) => (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="min-w-0 sm:flex-1">
                    <div className="break-words text-sm text-slate-100">{h.name}</div>
                    {confirmRemove === h.id ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-slate-400">Remove?</span>
                        <button
                          onClick={() => removeHabit(h.id)}
                          disabled={removing}
                          className="rounded-md border border-rose-900 px-2 py-1 text-xs text-rose-400 hover:bg-rose-950 disabled:opacity-40"
                        >
                          {removing ? "Removing…" : "Confirm"}
                        </button>
                        <button
                          onClick={() => setConfirmRemove(null)}
                          disabled={removing}
                          className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
                        <span className="whitespace-nowrap text-xs text-emerald-400">
                          +{h.points} pts
                        </span>
                        <button
                          onClick={() => setConfirmRemove(h.id)}
                          className="text-xs text-slate-600 hover:text-rose-400"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                  <div className={`flex self-end sm:shrink-0 sm:self-auto ${CELLS_GAP}`}>
                    {days.map((d) => {
                      const done = checks.has(checkKey(h.id, d));
                      const isToday = d === today;
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => toggle(h, d)}
                          aria-pressed={done}
                          aria-label={`${h.name} on ${d}${done ? " (done)" : ""}`}
                          className={`${CELL} flex items-center justify-center rounded-md border text-lg font-bold transition-colors ${
                            done
                              ? "border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-500"
                              : `bg-slate-800/40 text-transparent hover:bg-slate-800 ${
                                  isToday ? "border-emerald-800" : "border-slate-700"
                                }`
                          }`}
                        >
                          ✓
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            />

            {/* Per-day bonus row. */}
            <div className={`flex flex-col gap-1 border-t border-slate-800 py-2 sm:flex-row sm:items-center sm:gap-2 ${ROW_PX}`}>
              <div className="min-w-0 text-xs text-slate-500 sm:flex-1">
                All done ★
              </div>
              <div className={`flex self-end sm:shrink-0 sm:self-auto ${CELLS_GAP}`}>
                {days.map((d) => {
                  const earned = bonuses.has(d);
                  const pts = bonuses.get(d);
                  return (
                    <div
                      key={d}
                      title={earned ? "All habits done" : undefined}
                      className={`${CELL_W} text-center text-[11px] leading-tight sm:text-xs ${
                        earned ? "text-amber-300" : "text-slate-700"
                      }`}
                    >
                      {earned ? (
                        <>
                          <div>★</div>
                          {pts != null && <div>+{pts}</div>}
                        </>
                      ) : (
                        <div>·</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <form
        onSubmit={addHabit}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4"
      >
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="text-xs text-slate-400">Habit</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="e.g. Stretch for 10 minutes"
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-base text-white focus:border-emerald-500 focus:outline-none sm:w-64 sm:text-sm"
            required
          />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="text-xs text-slate-400">Points per day</label>
          <input
            type="number"
            min={1}
            max={100000}
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-base text-white focus:border-emerald-500 focus:outline-none sm:w-28 sm:text-sm"
            required
          />
        </div>
        <button
          type="submit"
          disabled={adding}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 sm:w-auto"
        >
          {adding ? "Adding…" : "Add habit"}
        </button>
      </form>
    </div>
  );
}
