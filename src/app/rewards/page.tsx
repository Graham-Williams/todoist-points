"use client";

import { useCallback, useEffect, useState } from "react";
import SortableList from "../SortableList";

interface Reward {
  id: number;
  name: string;
  cost: number;
  active: number;
}

export default function RewardsPage() {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [balance, setBalance] = useState(0);
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  // Inline cost editing: which reward is being edited, its draft value, and an
  // in-flight guard so controls disable while the PATCH is pending.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCost, setEditCost] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const load = useCallback(async () => {
    const [rRes, dRes] = await Promise.all([
      fetch("/api/rewards"),
      fetch("/api/dashboard"),
    ]);
    const rData = await rRes.json();
    const dData = await dRes.json();
    setRewards(rData.rewards ?? []);
    setBalance(dData.balance ?? 0);
  }, []);

  useEffect(() => {
    load();
    // Refetch when the global AutoSync reports new data.
    const onSynced = () => load();
    window.addEventListener("todoist:synced", onSynced);
    return () => window.removeEventListener("todoist:synced", onSynced);
  }, [load]);

  async function addReward(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const res = await fetch("/api/rewards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, cost: parseInt(cost, 10) }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error ?? "Failed to add reward");
      return;
    }
    setName("");
    setCost("");
    load();
  }

  async function redeem(id: number) {
    setStatus(null);
    const res = await fetch(`/api/rewards/${id}/redeem`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error ?? "Redeem failed");
      return;
    }
    setStatus("Redeemed!");
    load();
  }

  async function toggleActive(r: Reward) {
    await fetch(`/api/rewards/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !r.active }),
    });
    load();
  }

  async function remove(id: number) {
    await fetch(`/api/rewards/${id}`, { method: "DELETE" });
    load();
  }

  function startEdit(r: Reward) {
    setStatus(null);
    setEditingId(r.id);
    setEditCost(String(r.cost));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditCost("");
  }

  // Persist a new drag order: optimistic local update, then POST. On failure,
  // reload the list from the server and surface the error.
  async function reorder(newItems: Reward[]) {
    setRewards(newItems);
    try {
      const res = await fetch("/api/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          list: "rewards",
          order: newItems.map((r) => String(r.id)),
        }),
      });
      if (!res.ok) throw new Error("Failed to save order");
    } catch (err) {
      setStatus((err as Error).message);
      load();
    }
  }

  async function saveCost(id: number) {
    const n = parseInt(editCost, 10);
    if (!Number.isInteger(n) || n < 1) {
      setStatus("Cost must be a whole number of at least 1.");
      return;
    }
    setStatus(null);
    setEditBusy(true);
    try {
      const res = await fetch(`/api/rewards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cost: n }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error ?? "Failed to update cost");
        return;
      }
      cancelEdit();
      await load();
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Rewards</h1>
        <span className="text-sm text-slate-400">
          Balance:{" "}
          <span className="font-semibold text-emerald-400">{balance}</span> pts
        </span>
      </div>

      <form
        onSubmit={addReward}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Reward name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 1 hour of Rocket League"
            className="w-64 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Cost</label>
          <input
            type="number"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="100"
            className="w-28 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
            required
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          Add reward
        </button>
        {status && <span className="text-sm text-slate-400">{status}</span>}
      </form>

      {rewards.length === 0 ? (
        <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
          <li className="px-4 py-3 text-sm text-slate-500">No rewards yet.</li>
        </ul>
      ) : (
        <SortableList
          items={rewards}
          getKey={(r) => String(r.id)}
          onReorder={reorder}
          ulClassName="divide-y divide-slate-800 rounded-xl border border-slate-800"
          liClassName="px-4 py-3"
          renderItem={(r) => (
            <div
              className={`flex items-center justify-between gap-4 ${
                r.active ? "" : "opacity-50"
              }`}
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-slate-100">{r.name}</div>
                {editingId === r.id ? (
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={editCost}
                      onChange={(e) => setEditCost(e.target.value)}
                      disabled={editBusy}
                      className="w-24 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-right text-xs text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                    />
                    <span className="text-xs text-slate-400">pts</span>
                    <button
                      onClick={() => saveCost(r.id)}
                      disabled={editBusy}
                      className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                    >
                      {editBusy ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={editBusy}
                      className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="text-xs text-slate-400">{r.cost} pts</span>
                    <button
                      onClick={() => startEdit(r)}
                      className="text-xs text-slate-500 hover:text-slate-300"
                    >
                      Edit
                    </button>
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => redeem(r.id)}
                  disabled={!r.active || balance < r.cost}
                  className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
                >
                  Redeem
                </button>
                <button
                  onClick={() => toggleActive(r)}
                  className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                >
                  {r.active ? "Deactivate" : "Activate"}
                </button>
                <button
                  onClick={() => remove(r.id)}
                  className="rounded-md border border-rose-900 px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-950"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        />
      )}
    </div>
  );
}
