"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SortableList from "../SortableList";
import { formatPoints } from "@/lib/points";
import {
  DESCRIPTION_MAX,
  REWARD_COST_MAX,
  REWARD_NAME_MAX,
  parseIntInRange,
} from "@/lib/validate";

interface Reward {
  id: number;
  name: string;
  description: string | null;
  cost: number;
  active: number;
}

export default function RewardsPage() {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [balance, setBalance] = useState(0);
  // Add form.
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Inline edit of one reward (name / description / cost): which reward is
  // being edited, its drafts, and an in-flight guard so the form disables
  // while the PATCH is pending.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCost, setEditCost] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  // Redeeming: one request at a time (ref-guarded so a fast double tap can't
  // redeem twice), and the reward awaiting "go below zero?" confirmation.
  const redeemingRef = useRef(false);
  const [redeeming, setRedeeming] = useState(false);
  const [confirmNegative, setConfirmNegative] = useState<Reward | null>(null);
  // True while a reorder is optimistically applied but not yet persisted — the
  // sync-driven refetch skips this list so it can't snap back the old order.
  const reordering = useRef(false);

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
    // Refetch when the global AutoSync reports new data — but not mid-reorder,
    // or an in-flight sync could clobber the optimistic order before it persists.
    const onSynced = () => {
      if (!reordering.current) load();
    };
    window.addEventListener("todoist:synced", onSynced);
    return () => window.removeEventListener("todoist:synced", onSynced);
  }, [load]);

  async function addReward(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const n = parseCost(cost);
    if (!name.trim() || n === null) {
      setStatus(COST_HINT);
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, cost: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.error ?? "Failed to add reward");
        return;
      }
      setName("");
      setDescription("");
      setCost("");
      await load();
    } finally {
      setAdding(false);
    }
  }

  // Redeem straight away when the balance covers the cost; otherwise ask
  // first, since redeeming would take the balance below zero.
  function onRedeemClick(r: Reward) {
    setStatus(null);
    if (r.cost > balance) {
      setConfirmNegative(r);
      return;
    }
    redeem(r, false);
  }

  async function redeem(r: Reward, allowNegative: boolean) {
    if (redeemingRef.current) return;
    redeemingRef.current = true;
    setRedeeming(true);
    setStatus(null);
    try {
      const res = await fetch(
        `/api/rewards/${r.id}/redeem`,
        allowNegative
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ allowNegative: true }),
            }
          : { method: "POST" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "insufficient_balance" && !allowNegative) {
          // The balance dropped since the page loaded: ask now, using the
          // server's figure.
          if (typeof data.balance === "number") setBalance(data.balance);
          setConfirmNegative(r);
          return;
        }
        setConfirmNegative(null);
        setStatus(data.error ?? "Redeem failed");
        return;
      }
      setConfirmNegative(null);
      setStatus("Redeemed!");
      await load();
    } finally {
      redeemingRef.current = false;
      setRedeeming(false);
    }
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
    setEditName(r.name);
    setEditDescription(r.description ?? "");
    setEditCost(String(r.cost));
  }

  function cancelEdit() {
    setEditingId(null);
  }

  // Persist a new drag order: optimistic local update, then POST. On failure,
  // reload the list from the server and surface the error.
  async function reorder(newItems: Reward[]) {
    reordering.current = true;
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
    } finally {
      reordering.current = false;
    }
  }

  async function saveEdit(id: number) {
    const n = parseCost(editCost);
    if (!editName.trim() || n === null) {
      setStatus(COST_HINT);
      return;
    }
    setStatus(null);
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/rewards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // A blank description clears it.
        body: JSON.stringify({ name: editName, description: editDescription, cost: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.error ?? "Failed to save reward");
        return;
      }
      cancelEdit();
      await load();
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Rewards</h1>
        <span className="text-sm text-slate-400">
          Balance:{" "}
          <span
            className={`font-semibold ${balance < 0 ? "text-rose-400" : "text-emerald-400"}`}
          >
            {formatPoints(balance)}
          </span>{" "}
          pts
        </span>
      </div>

      <form
        onSubmit={addReward}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4"
      >
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="text-xs text-slate-400">Reward name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={REWARD_NAME_MAX}
            placeholder="e.g. 1 hour of Rocket League"
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-base text-white focus:border-emerald-500 focus:outline-none sm:w-64 sm:text-sm"
            required
          />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="text-xs text-slate-400">Description (optional)</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={DESCRIPTION_MAX}
            placeholder="e.g. Weekends only"
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-base text-white focus:border-emerald-500 focus:outline-none sm:w-64 sm:text-sm"
          />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="text-xs text-slate-400">Cost</label>
          <input
            type="number"
            min={1}
            max={REWARD_COST_MAX}
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="100"
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-base text-white focus:border-emerald-500 focus:outline-none sm:w-28 sm:text-sm"
            required
          />
        </div>
        <button
          type="submit"
          disabled={adding}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 sm:w-auto"
        >
          {adding ? "Adding…" : "Add reward"}
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
              className={`flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${
                r.active ? "" : "opacity-50"
              }`}
            >
              <div className="min-w-0 sm:flex-1">
                {editingId === r.id ? (
                  <div className="space-y-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      maxLength={REWARD_NAME_MAX}
                      disabled={savingEdit}
                      aria-label="Reward name"
                      className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-base text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50 sm:text-sm"
                    />
                    <textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      maxLength={DESCRIPTION_MAX}
                      rows={2}
                      disabled={savingEdit}
                      placeholder="Description (optional)"
                      aria-label="Reward description"
                      className="w-full resize-y rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-base text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50 sm:text-xs"
                    />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={REWARD_COST_MAX}
                          value={editCost}
                          onChange={(e) => setEditCost(e.target.value)}
                          disabled={savingEdit}
                          aria-label="Cost in points"
                          className="w-24 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-right text-base text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50 sm:text-xs"
                        />
                        <span className="text-xs text-slate-400">pts</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => saveEdit(r.id)}
                          disabled={savingEdit}
                          className="rounded-md bg-emerald-600 px-2.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 sm:py-1"
                        >
                          {savingEdit ? "Saving…" : "Save"}
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={savingEdit}
                          className="rounded-md border border-slate-700 px-2.5 py-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40 sm:py-1"
                        >
                          Cancel
                        </button>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Changes apply to future redemptions; past redemptions
                        keep the name and cost they had.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="break-words text-sm text-slate-100">
                      {r.name}
                    </div>
                    {r.description && (
                      <div className="mt-0.5 whitespace-pre-line break-words text-xs text-slate-400">
                        {r.description}
                      </div>
                    )}
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="whitespace-nowrap text-xs text-slate-400">
                        {r.cost} pts
                      </span>
                      <button
                        onClick={() => startEdit(r)}
                        className="text-xs text-slate-500 hover:text-slate-300"
                      >
                        Edit
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                <button
                  onClick={() => onRedeemClick(r)}
                  disabled={!r.active || redeeming}
                  className="shrink-0 whitespace-nowrap rounded-md bg-sky-600 px-3 py-2 text-xs sm:py-1.5 font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
                >
                  Redeem
                </button>
                <button
                  onClick={() => toggleActive(r)}
                  className="shrink-0 whitespace-nowrap rounded-md border border-slate-700 px-3 py-2 text-xs sm:py-1.5 text-slate-300 hover:bg-slate-800"
                >
                  {r.active ? "Deactivate" : "Activate"}
                </button>
                <button
                  onClick={() => remove(r.id)}
                  className="shrink-0 whitespace-nowrap rounded-md border border-rose-900 px-3 py-2 text-xs sm:py-1.5 text-rose-400 hover:bg-rose-950"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        />
      )}

      {confirmNegative && (
        <ConfirmNegativeDialog
          name={confirmNegative.name}
          cost={confirmNegative.cost}
          balance={balance}
          busy={redeeming}
          onCancel={() => setConfirmNegative(null)}
          onConfirm={() => redeem(confirmNegative, true)}
        />
      )}
    </div>
  );
}

// In-app "go below zero?" confirmation (not window.confirm, which blocks the
// page and browser automation). A modal dialog: focus moves to Cancel on open,
// Tab stays inside, Esc or a backdrop click cancels (ignored while the redeem
// is in flight), and focus returns to the Redeem button on close.
function ConfirmNegativeDialog({
  name,
  cost,
  balance,
  busy,
  onCancel,
  onConfirm,
}: {
  name: string;
  cost: number;
  balance: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const after = balance - cost;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!busy) onCancel();
      } else if (e.key === "Tab") {
        const focusable = Array.from(
          panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []
        );
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const inside = panelRef.current?.contains(document.activeElement) ?? false;
        if (e.shiftKey && (document.activeElement === first || !inside)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-negative-title"
        aria-describedby="confirm-negative-body"
        className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-xl"
      >
        <h2 id="confirm-negative-title" className="text-lg font-semibold text-slate-100">
          Go below zero?
        </h2>
        <p id="confirm-negative-body" className="mt-2 break-words text-sm text-slate-300">
          Redeeming <span className="font-semibold text-slate-100">{name}</span> costs{" "}
          <span className="whitespace-nowrap">{cost} pts</span>. Your balance will go from{" "}
          <span
            className={`whitespace-nowrap font-semibold ${
              balance < 0 ? "text-rose-400" : "text-emerald-400"
            }`}
          >
            {formatPoints(balance)}
          </span>{" "}
          to{" "}
          <span
            className={`whitespace-nowrap font-semibold ${
              after < 0 ? "text-rose-400" : "text-emerald-400"
            }`}
          >
            {formatPoints(after)}
          </span>
          .
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40 sm:py-1.5"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-40 sm:py-1.5"
          >
            {busy ? "Redeeming…" : "Redeem anyway"}
          </button>
        </div>
      </div>
    </div>
  );
}

const COST_HINT = `Enter a name and a whole-number cost (1–${REWARD_COST_MAX}).`;

// A whole-number cost from an input's text, else null. The server validates
// the same range with the same helper; this only gates the request.
const parseCost = (raw: string) => parseIntInRange(raw, 1, REWARD_COST_MAX);
