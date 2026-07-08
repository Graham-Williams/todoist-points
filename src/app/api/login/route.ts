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

// Redirect with a RELATIVE Location so the browser resolves it against the real
// request origin. Building an absolute URL from `req.url` is unsafe here: in the
// Next standalone server (Node runtime) behind the Cloudflare tunnel, `req.url`
// carries the container's internal bind host (0.0.0.0:3000), so an absolute
// redirect would send the browser to http://0.0.0.0/ (ERR_CONNECTION_REFUSED).
function redirect(location: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: location } });
}

// Build a relative /login path with query params (values are URL-encoded).
function loginPath(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `/login?${qs}` : "/login";
}

// POST /api/login — validate the shared password and, on success, set a signed
// session cookie. Constant-time compare; failures are rate-limited per client
// IP. The submitted password is never logged.
export async function POST(req: NextRequest) {
  const appPassword = process.env.APP_PASSWORD;
  const sessionSecret = process.env.SESSION_SECRET;

  // Gate OFF: nothing to sign in to — send them to the app.
  if (!appPassword) {
    return redirect("/");
  }
  // Gate ON but misconfigured — refuse rather than issue an unsignable cookie.
  if (!sessionSecret) {
    console.error("APP_PASSWORD is set but SESSION_SECRET is missing.");
    return redirect(loginPath({ error: "config" }));
  }

  const ip = clientIp(req.headers);

  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const next = safeNextPath(String(form.get("next") ?? "/"));

  if (isRateLimited(ip)) {
    return redirect(loginPath({ error: "rate", next }));
  }

  const ok = await passwordMatches(password, appPassword, sessionSecret);
  if (!ok) {
    recordFailure(ip);
    return redirect(loginPath({ error: "1", next }));
  }

  clearFailures(ip);
  const token = await createSessionToken(sessionSecret);
  const res = redirect(next);
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
