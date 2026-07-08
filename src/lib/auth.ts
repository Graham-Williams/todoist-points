// Shared-password auth primitives for the app-level sign-in gate.
//
// IMPORTANT: this module runs in BOTH the Edge runtime (Next.js middleware)
// and the Node runtime (the /api/login route handler). It therefore uses
// ONLY Web-standard crypto (`crypto.subtle`, `btoa`/`atob`, `TextEncoder`) —
// no Node built-ins, no npm deps — so it is safe on the Edge.
//
// Security model:
//   - APP_PASSWORD is a shared secret; setting it turns the gate ON.
//   - SESSION_SECRET signs the session cookie (HMAC-SHA256). The raw password
//     is NEVER stored in the cookie — only a signed marker.
//   - The password is compared in constant time by HMAC-ing both the submitted
//     value and the expected value with SESSION_SECRET and comparing the
//     resulting digests (equal-length, content-independent) — never `===` on
//     the raw strings.

export const SESSION_COOKIE = "tp_session";

// 30 days. The whole point of the shared password is that re-auth is rare.
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;

const TOKEN_VERSION = "v1";
// Small negative tolerance for clock skew between issuing and verifying.
const CLOCK_SKEW_S = 60;

const encoder = new TextEncoder();

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return new Uint8Array(sig);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Constant-time comparison of two byte arrays (no early return on mismatch).
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Constant-time comparison of two strings by comparing their UTF-8 bytes.
function timingSafeEqualStr(a: string, b: string): boolean {
  return timingSafeEqualBytes(encoder.encode(a), encoder.encode(b));
}

/**
 * Constant-time password check. Both the submitted input and the expected
 * secret are HMAC'd with SESSION_SECRET and the digests compared — so the
 * comparison time is independent of the password contents/length and no raw
 * `===` on the secret ever happens.
 */
export async function passwordMatches(
  input: string,
  expected: string,
  sessionSecret: string
): Promise<boolean> {
  const [hi, he] = await Promise.all([
    hmac(sessionSecret, input),
    hmac(sessionSecret, expected),
  ]);
  return timingSafeEqualBytes(hi, he);
}

/**
 * Create a signed session token: `v1.<issuedAtSeconds>.<base64url(hmac)>`.
 * The signature covers `v1.<issuedAtSeconds>`, so the cookie cannot be forged
 * or its issue time altered without SESSION_SECRET.
 */
export async function createSessionToken(
  sessionSecret: string,
  now: number = Date.now()
): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const payload = `${TOKEN_VERSION}.${issuedAt}`;
  const sig = bytesToBase64Url(await hmac(sessionSecret, payload));
  return `${payload}.${sig}`;
}

/**
 * Verify a session token's HMAC signature (constant-time) and freshness.
 * Returns true only when the signature is valid AND the token is within the
 * max age window (belt-and-suspenders alongside the cookie maxAge).
 */
export async function verifySessionToken(
  sessionSecret: string,
  token: string | undefined | null,
  now: number = Date.now()
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, issuedAtStr, sig] = parts;
  if (version !== TOKEN_VERSION) return false;

  const issuedAt = Number(issuedAtStr);
  if (!Number.isInteger(issuedAt) || issuedAt <= 0) return false;

  const ageS = Math.floor(now / 1000) - issuedAt;
  if (ageS < -CLOCK_SKEW_S || ageS > SESSION_MAX_AGE_S) return false;

  const payload = `${version}.${issuedAtStr}`;
  const expected = bytesToBase64Url(await hmac(sessionSecret, payload));
  return timingSafeEqualStr(sig, expected);
}

/**
 * Open-redirect-safe validation of a `next` target. Only same-site absolute
 * paths are allowed; anything else falls back to "/". Rejects protocol-relative
 * (`//host`), scheme-bearing, and backslash-obfuscated values, and refuses to
 * bounce back to the auth routes (which would loop).
 */
export function safeNextPath(next: string | null | undefined): string {
  const fallback = "/";
  if (!next || typeof next !== "string") return fallback;
  // Must be a single-slash absolute path.
  if (!next.startsWith("/")) return fallback;
  // Protocol-relative URL (`//evil.com`) — browsers treat as absolute.
  if (next.startsWith("//")) return fallback;
  // Backslashes are normalized to slashes by some browsers → `/\evil.com`.
  if (next.includes("\\")) return fallback;
  // Control chars / whitespace are never in a legit path.
  if (/[\x00-\x1f\x7f]/.test(next)) return fallback;
  // Don't bounce back to the auth endpoints.
  const path = next.split("?")[0];
  if (path === "/login" || path === "/logout" || path === "/api/login" || path === "/api/logout") {
    return fallback;
  }
  return next;
}

// ---------------------------------------------------------------------------
// In-memory per-IP failed-login rate limiter. Lives in the Node runtime of the
// /api/login route handler (module-level state persists across requests in a
// single container). A restart resets it — acceptable for a single-user app.
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_MAX_FAILURES = 10; // block after this many failures within the window

type Bucket = { count: number; resetAt: number };
const failures = new Map<string, Bucket>();

// Opportunistic cleanup so the Map can't grow unbounded from spoofed IPs.
function sweep(now: number): void {
  if (failures.size < 1000) return;
  for (const [ip, b] of failures) {
    if (now > b.resetAt) failures.delete(ip);
  }
}

export function isRateLimited(ip: string, now: number = Date.now()): boolean {
  const b = failures.get(ip);
  if (!b) return false;
  if (now > b.resetAt) {
    failures.delete(ip);
    return false;
  }
  return b.count >= RATE_MAX_FAILURES;
}

export function recordFailure(ip: string, now: number = Date.now()): void {
  sweep(now);
  const b = failures.get(ip);
  if (!b || now > b.resetAt) {
    failures.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
  } else {
    b.count += 1;
  }
}

export function clearFailures(ip: string): void {
  failures.delete(ip);
}

// Test-only reset hook.
export function _resetRateLimiterForTests(): void {
  failures.clear();
}

/**
 * Derive the client IP for rate limiting. Behind Cloudflare the trustworthy
 * source is `CF-Connecting-IP`; `x-forwarded-for` (first hop) is the fallback.
 */
export function clientIp(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}
