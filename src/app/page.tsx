import { getStats } from "@/lib/queries";
import type { EarningBadge } from "@/lib/earningSource";
import DashboardRefresh from "./DashboardRefresh";
import EarningControls from "./EarningControls";

export const dynamic = "force-dynamic";

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="text-sm text-slate-400">{label}</div>
      <div className={`mt-1 text-3xl font-bold ${accent}`}>{value}</div>
    </div>
  );
}

// Color-coded pill per earning source. Label badges reuse the neutral slate
// pill from the review page; manual/pre-assigned get their own accent so the
// provenance reads at a glance.
const BADGE_STYLES: Record<EarningBadge["kind"], string> = {
  manual: "border-amber-900 bg-amber-950/40 text-amber-300",
  "pre-assigned": "border-violet-900 bg-violet-950/40 text-violet-300",
  label: "border-slate-700 bg-slate-800 text-slate-300",
};

function SourceBadge({ badge }: { badge: EarningBadge }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${BADGE_STYLES[badge.kind]}`}
    >
      {badge.text}
    </span>
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
        <StatCard label="Balance" value={stats.balance} accent="text-emerald-400" />
        <StatCard label="Total earned" value={stats.totalEarned} accent="text-sky-400" />
        <StatCard label="Total spent" value={stats.totalSpent} accent="text-rose-400" />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent earnings</h2>
        {stats.recentEarnings.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nothing yet. Configure label points and complete some tasks — points
            sync in automatically.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
            {stats.recentEarnings.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-sm text-slate-200">{e.title}</span>
                  {e.badges.map((badge, i) => (
                    <SourceBadge key={`${badge.kind}-${badge.text}-${i}`} badge={badge} />
                  ))}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-semibold text-emerald-400">+{e.points}</span>
                  <EarningControls id={e.id} points={e.points} />
                </div>
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
