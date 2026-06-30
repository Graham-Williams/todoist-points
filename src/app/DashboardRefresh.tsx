"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// The dashboard is a server component, so when a global sync completes we
// re-run it via router.refresh() rather than refetching client-side. Listens
// for the `todoist:synced` event emitted by the layout's AutoSync.
export default function DashboardRefresh() {
  const router = useRouter();
  useEffect(() => {
    const onSynced = () => router.refresh();
    window.addEventListener("todoist:synced", onSynced);
    return () => window.removeEventListener("todoist:synced", onSynced);
  }, [router]);
  return null;
}
