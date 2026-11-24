import { getStats } from "@/lib/queries";
import { formatPoints, formatSignedPoints } from "@/lib/points";
import DashboardRefresh from "./DashboardRefresh";
import EarningControls from "./EarningControls";
import BalanceCard from "./BalanceCard";

export const dynamic = "force-dynamic";

// A negative value (net earned can dip below zero) turns rose with a "−".
function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="text-sm text-slate-400">{label}</div>
      <div className={`mt-1 text-3xl font-bold ${value < 0 ? "text-rose-400" : accent}`}>
        {formatPoints(value)}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const stats = getStats();
  return (
    <div className="space-y-8">
      <DashboardRefresh />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <BalanceCard balance={stats.balance} />
        <StatCard label="Net earned" value={stats.netEarned} accent="text-sky-400" />
        <StatCard label="Total spent" value={stats.totalSpent} accent="text-rose-400" />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent earnings/losses</h2>
        {stats.recentEarnings.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nothing yet. Complete tasks in Todoist — they show up in Review,
            where you assign their points.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
            {stats.recentEarnings.map((e) => {
              // A loss (missed-habit penalty) is marked three ways, so it
              // never depends on colour alone: a red-tinted row, a "Loss"
              // pill, and a "−" amount.
              const loss = e.points < 0;
              return (
                <li
                  key={e.id}
                  className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${
                    loss ? "bg-rose-950/40" : ""
                  }`}
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    {loss && (
                      <span className="shrink-0 rounded-full border border-rose-700 bg-rose-900/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-200">
                        Loss
                      </span>
                    )}
                    <span className="min-w-0 break-words text-sm text-slate-200">{e.title}</span>
                  </span>
                  <div className="flex items-center gap-3 sm:shrink-0">
                    <span
                      className={`shrink-0 whitespace-nowrap font-semibold ${
                        loss ? "text-rose-400" : "text-emerald-400"
                      }`}
                    >
                      {formatSignedPoints(e.points)}
                    </span>
                    <EarningControls id={e.id} points={e.points} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Spending &amp; adjustments</h2>
        {stats.history.length === 0 ? (
          <p className="text-sm text-slate-500">No redemptions or adjustments yet.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
            {stats.history.map((e) => (
              <li
                key={`${e.kind}-${e.id}`}
                className="flex items-start justify-between gap-4 px-4 py-3"
              >
                <span className="min-w-0 break-words text-sm text-slate-200">
                  {e.description ?? (e.kind === "adjust" ? "Balance adjustment" : "Redemption")}
                </span>
                <span
                  className={`shrink-0 whitespace-nowrap font-semibold ${
                    e.kind === "redeem"
                      ? "text-rose-400"
                      : e.points >= 0
                        ? "text-sky-400"
                        : "text-amber-400"
                  }`}
                >
                  {e.points > 0 ? `+${e.points}` : e.points}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
