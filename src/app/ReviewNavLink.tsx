"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Nav link for the review queue with a small count badge. The badge shows the
// total number of things awaiting a points decision: completed-but-unassigned
// tasks (the /api/review queue) PLUS upcoming dated tasks that don't yet have a
// saved override (/api/upcoming rows with points == null). The count is fetched
// client-side (the layout is a server component and can't easily poll). Kept
// simple: one fetch on mount, refreshed on focus and after each sync.
export default function ReviewNavLink() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [reviewRes, upcomingRes] = await Promise.all([
          fetch("/api/review"),
          fetch("/api/upcoming"),
        ]);
        if (!reviewRes.ok || !upcomingRes.ok) return;
        const reviewData = await reviewRes.json();
        const upcomingData = await upcomingRes.json();
        const pending = (reviewData.tasks ?? []).length;
        const upcomingUnassigned = (upcomingData.tasks ?? []).filter(
          (t: { points: number | null }) => t.points == null
        ).length;
        if (!cancelled) setCount(pending + upcomingUnassigned);
      } catch {
        // Ignore — badge is best-effort.
      }
    };
    load();
    const onFocus = () => load();
    const onSynced = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("todoist:synced", onSynced);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("todoist:synced", onSynced);
    };
  }, []);

  return (
    <Link
      href="/review"
      className="flex items-center gap-1.5 text-slate-300 hover:text-white"
    >
      Review
      {count > 0 && (
        <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-xs font-semibold text-amber-300">
          {count}
        </span>
      )}
    </Link>
  );
}
