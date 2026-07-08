import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  clientIp,
  createSessionToken,
  isRateLimited,
  passwordMatches,
  recordFailure,
  clearFailures,
  safeNextPath,
} from "@/lib/auth";

// POST /api/login — validate the shared password and, on success, set a signed
// session cookie. Constant-time compare; failures are rate-limited per client
// IP. The submitted password is never logged.
export async function POST(req: NextRequest) {
  const appPassword = process.env.APP_PASSWORD;
  const sessionSecret = process.env.SESSION_SECRET;

  // Gate OFF: nothing to sign in to — send them to the app.
  if (!appPassword) {
    return NextResponse.redirect(new URL("/", req.url), { status: 303 });
  }
  // Gate ON but misconfigured — refuse rather than issue an unsignable cookie.
  if (!sessionSecret) {
    console.error("APP_PASSWORD is set but SESSION_SECRET is missing.");
    return NextResponse.redirect(new URL("/login?error=config", req.url), {
      status: 303,
    });
  }

  const ip = clientIp(req.headers);

  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const next = safeNextPath(String(form.get("next") ?? "/"));

  if (isRateLimited(ip)) {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", "rate");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303 });
  }

  const ok = await passwordMatches(password, appPassword, sessionSecret);
  if (!ok) {
    recordFailure(ip);
    const url = new URL("/login", req.url);
    url.searchParams.set("error", "1");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303 });
  }

  clearFailures(ip);
  const token = await createSessionToken(sessionSecret);
  const res = NextResponse.redirect(new URL(next, req.url), { status: 303 });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Secure in production (behind Cloudflare the browser<->edge hop is HTTPS,
    // so the flag is honored even though the tunnel<->container hop is HTTP).
    // Relaxed in dev so the gate is testable over http://localhost.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}
