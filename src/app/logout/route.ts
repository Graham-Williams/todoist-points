import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

// Clear the session cookie and return to the login page. Supported over GET
// (a simple "Sign out" link) and POST. Logout is not a sensitive mutation, so
// it isn't origin-pinned; the worst a forged logout can do is sign the user out.
//
// The Location is RELATIVE so the browser resolves it against the real request
// origin. Never build it from `req.url`: in the Next standalone server behind
// the Cloudflare tunnel that carries the container bind host (0.0.0.0:3000),
// so an absolute redirect would send the browser to http://0.0.0.0:3000/login
// (ERR_CONNECTION_REFUSED). Same approach as /api/login.
function clearAndRedirect(): NextResponse {
  const res = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  // Same attributes as the login cookie (maxAge 0 = delete it) — they must
  // match or the browser keeps the original cookie alongside the blank one.
  res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return res;
}

// The request is deliberately unused: nothing about it (least of all its URL)
// feeds the response.
export function GET(_req: NextRequest) {
  return clearAndRedirect();
}

export function POST(_req: NextRequest) {
  return clearAndRedirect();
}
