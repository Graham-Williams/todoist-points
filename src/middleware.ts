import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, safeNextPath, verifySessionToken } from "@/lib/auth";
import {
  HSTS_HEADER,
  HSTS_VALUE,
  HTTPS_REDIRECT_HEADERS,
  HTTPS_REDIRECT_STATUS,
  httpsRedirectTarget,
} from "@/lib/https";

// Authentication / defense-in-depth for the deployment. Two independent gates,
// each env-activated, plus a CSRF/origin pin and origin-side HTTPS
// enforcement:
//
// 0. HTTPS ENFORCEMENT (runs FIRST, before any gate). When a request carries a
//    Cloudflare marker, says the visitor arrived over plain http, and is
//    addressed to APP_HOST, it is 307'd (temporary, no-store) to
//    `https://<APP_HOST><path><query>` — so a plain-http visitor never reaches
//    the password gate or the login page. Anything without a Cloudflare marker
//    fails OPEN, because Next synthesizes `x-forwarded-proto: http` and a
//    proto-only rule would bounce such a request to the URL it already asked
//    for. Every response this middleware produces (including the short-circuit
//    307/401/403 ones) carries `Strict-Transport-Security: max-age=31536000`.
//    Full rules, the header-synthesis gotcha and the `req.url` gotcha live in
//    src/lib/https.ts.
//
// A. APP-LEVEL PASSWORD GATE (the active gate after the Cloudflare-Access
//    cutover). When APP_PASSWORD is set, every request that isn't a public
//    path (login/logout, health, Next static assets, icons) and doesn't carry
//    a valid signed session cookie is redirected to /login (or 401 for /api/*).
//    The session cookie is an HMAC-signed marker verified with SESSION_SECRET;
//    an unsigned/forged cookie is rejected. Unset/empty APP_PASSWORD = gate OFF
//    (the app behaves exactly as before — nothing is required).
//
// B. CLOUDFLARE ACCESS JWT (legacy; kept for the pre-cutover deployment). When
//    CF_ACCESS_AUD + CF_ACCESS_TEAM_DOMAIN are BOTH set AND the password gate
//    is OFF, every request must carry a valid Cloudflare Access JWT (header
//    `Cf-Access-Jwt-Assertion`, falling back to the `CF_Authorization` cookie);
//    the RS256 signature is verified against the team's JWKS and aud/iss/exp/nbf
//    checked. Invalid/missing → 403. The password gate takes precedence: when
//    APP_PASSWORD is set this block is skipped so the two never conflict.
//
// C. When APP_HOST is set, non-GET/HEAD requests must have a matching Origin
//    (when present) and Host header — a CSRF/origin pin (also covers the login
//    POST). Runs first, for every request.
//
// With none of these env vars set (local dev), the middleware is a no-op.
//
// Runs on the Edge runtime: no Node crypto, no npm deps — WebCrypto only.

const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

type Jwk = JsonWebKey & { kid?: string };

// Module-level JWKS cache (persists across requests within a runtime instance).
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

function forbidden(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

function base64UrlDecodeToBytes(input: string): Uint8Array<ArrayBuffer> {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  // Explicit ArrayBuffer backing so the result satisfies WebCrypto's
  // BufferSource type (Uint8Array<ArrayBufferLike> doesn't).
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeToJson(input: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(input)));
}

async function fetchJwks(teamDomain: string): Promise<Jwk[]> {
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  if (!Array.isArray(body.keys)) throw new Error("JWKS response has no keys");
  return body.keys;
}

// Returns the JWK matching `kid`, refetching once on a cache miss (handles
// Cloudflare's key rotation) or when the cache is older than JWKS_TTL_MS.
async function getSigningKey(teamDomain: string, kid: string): Promise<Jwk | undefined> {
  const now = Date.now();
  if (!jwksCache || now - jwksCache.fetchedAt > JWKS_TTL_MS) {
    jwksCache = { keys: await fetchJwks(teamDomain), fetchedAt: now };
  }
  let key = jwksCache.keys.find((k) => k.kid === kid);
  if (!key) {
    jwksCache = { keys: await fetchJwks(teamDomain), fetchedAt: Date.now() };
    key = jwksCache.keys.find((k) => k.kid === kid);
  }
  return key;
}

async function verifyAccessJwt(
  token: string,
  aud: string,
  teamDomain: string
): Promise<boolean> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64, signatureB64] = parts;

    const header = base64UrlDecodeToJson(headerB64) as { alg?: string; kid?: string };
    if (header.alg !== "RS256" || !header.kid) return false;

    const jwk = await getSigningKey(teamDomain, header.kid);
    if (!jwk) return false;

    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      base64UrlDecodeToBytes(signatureB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );
    if (!valid) return false;

    const payload = base64UrlDecodeToJson(payloadB64) as {
      aud?: string | string[];
      iss?: string;
      exp?: number;
      nbf?: number;
    };
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(aud)) return false;
    if (payload.iss !== `https://${teamDomain}`) return false;

    const nowSec = Math.floor(Date.now() / 1000);
    const leeway = 60; // seconds of clock-skew tolerance
    if (typeof payload.exp !== "number" || payload.exp < nowSec - leeway) return false;
    if (typeof payload.nbf === "number" && payload.nbf > nowSec + leeway) return false;

    return true;
  } catch {
    return false;
  }
}

// Paths reachable WITHOUT a session (when the password gate is active): the
// auth endpoints themselves, the container healthcheck, and Next's build
// assets / icon routes (needed to render the login page). Everything else is
// gated.
function isPublicPath(pathname: string): boolean {
  if (pathname === "/login") return true;
  if (pathname === "/logout") return true;
  if (pathname === "/api/login") return true;
  if (pathname === "/api/logout") return true;
  if (pathname === "/api/health") return true; // healthcheck endpoint
  if (pathname.startsWith("/_next/")) return true; // JS/CSS/HMR chunks
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/icon.svg" || pathname === "/icon") return true;
  if (pathname === "/apple-icon" || pathname.startsWith("/apple-icon/")) return true;
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml") return true;
  return false;
}

// Every response leaves through here, so HSTS is attached in exactly one
// place and cannot be missed by a short-circuit return (the /login redirect,
// the 401 for /api/*, the 403s). A `next.config.mjs` `headers()` entry would
// NOT cover those: custom headers are applied by the routing layer, which a
// response returned from middleware never reaches.
export async function middleware(req: NextRequest) {
  const res = await handle(req);
  res.headers.set(HSTS_HEADER, HSTS_VALUE);
  return res;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  // (0) HTTPS enforcement — before every gate, so a plain-http request is
  // bounced to https instead of being served the login page in the clear.
  // Fires only when the request carries a Cloudflare marker AND reports the
  // visitor's scheme as http AND is addressed to the public host, so both
  // in-network probes (Host: localhost:3000) and anything that never went
  // through Cloudflare are served normally. The Host is a GUARD only: the
  // target is always built from APP_HOST, never from req.url or the Host
  // header. See src/lib/https.ts for why each condition is load-bearing.
  const redirectTarget = httpsRedirectTarget({
    forwardedProto: req.headers.get("x-forwarded-proto"),
    requestHost: req.headers.get("host"),
    cfConnectingIp: req.headers.get("cf-connecting-ip"),
    cfVisitor: req.headers.get("cf-visitor"),
    appHost: process.env.APP_HOST,
    pathname: req.nextUrl.pathname,
    search: req.nextUrl.search,
  });
  if (redirectTarget) {
    // Built by hand rather than via NextResponse.redirect(new URL(...)) so the
    // path/query we assembled reach the Location header byte-for-byte.
    // 307, never 301: a permanent redirect is cached by browsers and would
    // outlive any fix to the logic that produced it.
    return new NextResponse(null, {
      status: HTTPS_REDIRECT_STATUS,
      headers: { ...HTTPS_REDIRECT_HEADERS, Location: redirectTarget },
    });
  }

  // (C) CSRF/origin pin: mutating requests must come from our own host.
  const appHost = process.env.APP_HOST;
  if (appHost && req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (originHost !== appHost) return forbidden();
    }
    if (req.headers.get("host") !== appHost) return forbidden();
  }

  // (A) App-level password gate — the active gate. When APP_PASSWORD is set,
  // require a valid signed session cookie for everything but public paths.
  const appPassword = process.env.APP_PASSWORD;
  if (appPassword) {
    const { pathname, search } = req.nextUrl;
    if (isPublicPath(pathname)) return NextResponse.next();

    const sessionSecret = process.env.SESSION_SECRET;
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const authed =
      !!sessionSecret && (await verifySessionToken(sessionSecret, token));
    if (authed) return NextResponse.next();

    // Unauthenticated. For API calls, a 401 is friendlier to fetch() than a
    // redirect to an HTML login page. For navigations, redirect to /login.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", safeNextPath(pathname + search));
    return NextResponse.redirect(loginUrl);
  }

  // (B) Cloudflare Access JWT verification (legacy; only when the password
  // gate is OFF and CF Access is fully configured).
  const accessAud = process.env.CF_ACCESS_AUD;
  const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN;
  if (accessAud && teamDomain) {
    const token =
      req.headers.get("cf-access-jwt-assertion") ??
      req.cookies.get("CF_Authorization")?.value;
    if (!token || !(await verifyAccessJwt(token, accessAud, teamDomain))) {
      return forbidden();
    }
  }

  return NextResponse.next();
}

// No matcher: intentionally run on EVERY path (pages, /api, static assets), so
// path exemptions are decided in code (isPublicPath) rather than a matcher —
// keeping the gate fail-closed by default.
