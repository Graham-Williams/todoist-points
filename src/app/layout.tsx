import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import AutoSync from "./AutoSync";
import ReviewNavLink from "./ReviewNavLink";

export const metadata: Metadata = {
  title: "Todoist Points",
  description: "A personal gamification layer for Todoist",
};

const navLinks = [
  { href: "/", label: "Dashboard" },
  { href: "/labels", label: "Labels & Points" },
  { href: "/rewards", label: "Rewards" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-slate-800 bg-slate-900/60">
          <nav className="mx-auto flex max-w-4xl items-center gap-6 px-6 py-4">
            <span className="text-lg font-bold text-emerald-400">
              Todoist Points
            </span>
            <div className="flex gap-4 text-sm">
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
            {/* Single global auto-sync loop; drives all pages via the
                `todoist:synced` event it emits after each successful sync. */}
            <div className="ml-auto">
              <AutoSync />
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
