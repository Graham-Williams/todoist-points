"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import AutoSync from "./AutoSync";
import ReviewNavLink from "./ReviewNavLink";

const navLinks = [
  { href: "/", label: "Dashboard" },
  { href: "/labels", label: "Labels & Points" },
  { href: "/rewards", label: "Rewards" },
  { href: "/about", label: "About" },
];

// Top navigation. Desktop (md+) shows the inline links row exactly as before;
// on phones the links collapse behind a ☰ hamburger that toggles a dropdown
// panel. CRITICAL: <AutoSync/> stays mounted at all times in the right cluster
// (it drives the global 15s sync loop) — the hamburger only toggles the links.
export default function NavBar({ showSignOut }: { showSignOut: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="border-b border-slate-800 bg-slate-900/60">
      <nav className="mx-auto flex max-w-4xl items-center gap-6 px-6 py-4">
        <Link
          href="/"
          className="text-lg font-bold text-emerald-400 hover:text-emerald-300"
        >
          Todoist Points
        </Link>

        {/* Desktop inline links (md and up). */}
        <div className="hidden gap-4 text-sm md:flex">
          {navLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-slate-300 hover:text-white"
            >
              {l.label}
            </Link>
          ))}
          <ReviewNavLink />
        </div>

        {/* Right cluster — always rendered. AutoSync must never unmount. */}
        <div className="ml-auto flex items-center gap-4">
          <AutoSync />
          {showSignOut ? (
            <a
              href="/logout"
              className="hidden text-sm text-slate-400 hover:text-white md:inline"
            >
              Sign out
            </a>
          ) : null}
          {/* Hamburger (mobile only). */}
          <button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="rounded-md px-2 py-1 text-xl text-slate-300 hover:text-white md:hidden"
          >
            ☰
          </button>
        </div>
      </nav>

      {/* Mobile dropdown panel (below the header). Toggles only the links. */}
      {open && (
        <div className="border-t border-slate-800 md:hidden">
          <div className="mx-auto flex max-w-4xl flex-col px-6 py-2 text-sm">
            {navLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="py-2 text-slate-300 hover:text-white"
              >
                {l.label}
              </Link>
            ))}
            <div className="py-2" onClick={() => setOpen(false)}>
              <ReviewNavLink />
            </div>
            {showSignOut ? (
              <a
                href="/logout"
                onClick={() => setOpen(false)}
                className="py-2 text-slate-400 hover:text-white"
              >
                Sign out
              </a>
            ) : null}
          </div>
        </div>
      )}
    </header>
  );
}
