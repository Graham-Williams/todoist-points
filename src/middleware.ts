import { NextRequest, NextResponse } from "next/server";

// Defense-in-depth behind Cloudflare Access (mirrors the km-tracker setup):
//
// 1. When CF_ACCESS_AUD + CF_ACCESS_TEAM_DOMAIN are BOTH set, every request
//    must carry a valid Cloudflare Access JWT (header `Cf-Access-Jwt-Assertion`,
//    falling back to the `CF_Authorization` cookie). The RS256 signature is
//    verified against the team's JWKS, and aud/iss/exp/nbf are checked.
//    Anything invalid or missing gets a 403 with no app data. So even if the
//    tunnel/network layer is misconfigured, unauthenticated traffic can't
//    reach the app.
// 2. When APP_HOST is set, non-GET/HEAD requests must have a matching Origin
//    (when present) and Host header — a CSRF/origin pin.
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

export async function middleware(req: NextRequest) {
  // CSRF/origin pin: mutating requests must come from our own host.
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

  // Cloudflare Access JWT verification (only when fully configured).
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

// No matcher: intentionally match EVERY path (pages, /api, static assets).
// Nothing is exempt — an unauthenticated request answering 403 is the
// expected health signal for the deployment (see DEPLOY.md).
