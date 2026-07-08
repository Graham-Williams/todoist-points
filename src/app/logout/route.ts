import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

// Clear the session cookie and return to the login page. Supported over GET
// (a simple "Sign out" link) and POST. Logout is not a sensitive mutation, so
// it isn't origin-pinned; the worst a forged logout can do is sign the user out.
function clearAndRedirect(req: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

export function GET(req: NextRequest) {
  return clearAndRedirect(req);
}

export function POST(req: NextRequest) {
  return clearAndRedirect(req);
}
