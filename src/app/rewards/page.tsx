"use client";

import { useCallback, useEffect, useState } from "react";

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

      <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
        {rewards.length === 0 && (
          <li className="px-4 py-3 text-sm text-slate-500">No rewards yet.</li>
        )}
        {rewards.map((r) => (
          <li
            key={r.id}
            className={`flex items-center justify-between gap-4 px-4 py-3 ${
              r.active ? "" : "opacity-50"
            }`}
          >
            <div className="min-w-0">
              <div className="truncate text-sm text-slate-100">{r.name}</div>
              <div className="text-xs text-slate-400">{r.cost} pts</div>
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
          </li>
        ))}
      </ul>
    </div>
  );
}
