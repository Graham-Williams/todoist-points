"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Nav link for the review queue with a small count badge. The count is fetched
// client-side (the layout is a server component and can't easily poll). Kept
// simple: one fetch on mount, refreshed when the tab regains focus.
export default function ReviewNavLink() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/review");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setCount((data.tasks ?? []).length);
      } catch {
        // Ignore — badge is best-effort.
      }
    };
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
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
