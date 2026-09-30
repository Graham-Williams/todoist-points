import { NextResponse } from "next/server";

// Unauthenticated liveness probe, exempt from the auth gate (see proxy.ts
// isPublicPath). Returns 200 without touching the DB or any secret — safe to
// expose. Used by the deploy sanity check.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true });
}
