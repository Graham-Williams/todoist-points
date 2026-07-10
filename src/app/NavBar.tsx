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

// Top navigation. On wide screens (lg+) the full inline links row shows; below
// lg the links, sync status, and Sign out collapse behind a ☰ hamburger so the
// bar never gets cramped enough to wrap mid-phrase (the old md breakpoint left
// an ugly ~768–1024px zone where everything squeezed and wrapped). Every item is
// whitespace-nowrap + shrink-0 so nothing ever breaks across lines. CRITICAL:
// <AutoSync/> stays mounted at all times in the right cluster (it drives the
// global 15s sync loop) — the hamburger only toggles the links.
export default function NavBar({ showSignOut }: { showSignOut: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="border-b border-slate-800 bg-slate-900/60">
      <nav className="mx-auto flex max-w-5xl items-center gap-8 px-6 py-4">
        <Link
          href="/"
          className="shrink-0 whitespace-nowrap text-lg font-bold tracking-tight text-emerald-400 hover:text-emerald-300"
        >
          Todoist Points
        </Link>

        {/* Desktop inline links (lg and up). */}
        <div className="hidden items-center gap-5 text-sm lg:flex">
          {navLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="whitespace-nowrap text-slate-300 hover:text-white"
            >
              {l.label}
            </Link>
          ))}
          <ReviewNavLink />
        </div>

        {/* Right cluster — always rendered. AutoSync must never unmount. */}
        <div className="ml-auto flex shrink-0 items-center gap-4">
          <AutoSync />
          {showSignOut ? (
            <a
              href="/logout"
              className="hidden whitespace-nowrap text-sm text-slate-400 hover:text-white lg:inline"
            >
              Sign out
            </a>
          ) : null}
          {/* Hamburger (below lg). */}
          <button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="rounded-md px-2 py-1 text-xl leading-none text-slate-300 hover:text-white lg:hidden"
          >
            ☰
          </button>
        </div>
      </nav>

      {/* Mobile dropdown panel (below the header). Toggles only the links. */}
      {open && (
        <div className="border-t border-slate-800 lg:hidden">
          <div className="mx-auto flex max-w-5xl flex-col px-6 py-2 text-sm">
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
