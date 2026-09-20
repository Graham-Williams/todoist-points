import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

// Clear the session cookie and return to the login page. Supported over GET
// (a simple "Sign out" link) and POST. Logout is not a sensitive mutation, so
// it isn't origin-pinned; the worst a forged logout can do is sign the user out.
function clearAndRedirect(req: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  // Same attributes as the login cookie (maxAge 0 = delete it) — they must
  // match or the browser keeps the original cookie alongside the blank one.
  res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return res;
}

export function GET(req: NextRequest) {
  return clearAndRedirect(req);
}

export function POST(req: NextRequest) {
  return clearAndRedirect(req);
}
