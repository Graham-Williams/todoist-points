import type { Metadata } from "next";
import "./globals.css";
import NavBar from "./NavBar";
import SiteFooter from "./SiteFooter";

export const metadata: Metadata = {
  title: "Todoist Points",
  description: "A personal gamification layer for Todoist",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        {/* NavBar is a client component so it can toggle the mobile menu; the
            server-only APP_PASSWORD check is passed down as a boolean prop. The
            single global auto-sync loop lives inside NavBar (AutoSync stays
            mounted) and drives all pages via the `todoist:synced` event. */}
        <NavBar showSignOut={!!process.env.APP_PASSWORD} />
        <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
