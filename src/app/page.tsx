import { getStats } from "@/lib/queries";
import SyncButton from "./SyncButton";

export const dynamic = "force-dynamic";

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="text-sm text-slate-400">{label}</div>
      <div className={`mt-1 text-3xl font-bold ${accent}`}>{value}</div>
    </div>
  );
}

export default function DashboardPage() {
  const stats = getStats();
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <SyncButton />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Balance" value={stats.balance} accent="text-emerald-400" />
        <StatCard label="Total earned" value={stats.totalEarned} accent="text-sky-400" />
        <StatCard label="Total spent" value={stats.totalSpent} accent="text-rose-400" />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent earnings</h2>
        {stats.recentEarnings.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nothing yet. Configure label points, then hit “Sync completed tasks”.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
            {stats.recentEarnings.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="truncate text-sm text-slate-200">{e.description}</span>
                <span className="shrink-0 font-semibold text-emerald-400">
                  +{e.points}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Redemption history</h2>
        {stats.redemptions.length === 0 ? (
          <p className="text-sm text-slate-500">No redemptions yet.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
            {stats.redemptions.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="truncate text-sm text-slate-200">{e.description}</span>
                <span className="shrink-0 font-semibold text-rose-400">{e.points}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
