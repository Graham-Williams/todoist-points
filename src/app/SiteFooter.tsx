"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// A small footer prompt pointing to the About page. Shown on every page
// except /about itself (no need to link a page to itself).
export default function SiteFooter() {
  const pathname = usePathname();
  if (pathname === "/about") return null;

  return (
    <footer className="mx-auto max-w-4xl px-6 pb-10 text-sm text-slate-500">
      <p>
        Not sure what a task is worth? Head to the{" "}
        <Link
          href="/about"
          className="font-medium text-emerald-400 hover:text-emerald-300"
        >
          About page
        </Link>{" "}
        to learn how to point!
      </p>
    </footer>
  );
}
