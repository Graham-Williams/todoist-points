// Unit tests for the shared-password auth primitives.
// Run with: npm test  (node --test, using Node's native TS type-stripping; no
// test-runner dependency).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSessionToken,
  verifySessionToken,
  passwordMatches,
  safeNextPath,
  isRateLimited,
  recordFailure,
  clearFailures,
  clientIp,
  SESSION_MAX_AGE_S,
  sessionCookieOptions,
  _resetRateLimiterForTests,
} from "./auth.ts";

const SECRET = "test-session-secret-please-change";

test("session token round-trips: valid signature verifies", async () => {
  const token = await createSessionToken(SECRET);
  assert.equal(await verifySessionToken(SECRET, token), true);
});

test("session token forged/tampered signature is rejected", async () => {
  const token = await createSessionToken(SECRET);
  const parts = token.split(".");
  parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith("A") ? "B" : "A");
  assert.equal(await verifySessionToken(SECRET, parts.join(".")), false);
});

test("session token signed with a different secret is rejected", async () => {
  const token = await createSessionToken(SECRET);
  assert.equal(await verifySessionToken("other-secret", token), false);
});

test("session token with altered issued-at is rejected (signature covers it)", async () => {
  const token = await createSessionToken(SECRET);
  const [v, iat, sig] = token.split(".");
  const forged = `${v}.${Number(iat) - 12345}.${sig}`;
  assert.equal(await verifySessionToken(SECRET, forged), false);
});

test("expired session token is rejected", async () => {
  const past = Date.now() - (SESSION_MAX_AGE_S + 3600) * 1000;
  const token = await createSessionToken(SECRET, past);
  assert.equal(await verifySessionToken(SECRET, token), false);
});

test("empty/garbage tokens are rejected", async () => {
  assert.equal(await verifySessionToken(SECRET, undefined), false);
  assert.equal(await verifySessionToken(SECRET, ""), false);
  assert.equal(await verifySessionToken(SECRET, "not.a.token"), false);
  assert.equal(await verifySessionToken(SECRET, "v1.abc.def"), false);
});

test("passwordMatches: correct password matches, wrong does not", async () => {
  assert.equal(await passwordMatches("hunter2", "hunter2", SECRET), true);
  assert.equal(await passwordMatches("hunter3", "hunter2", SECRET), false);
  assert.equal(await passwordMatches("", "hunter2", SECRET), false);
  assert.equal(await passwordMatches("hunter2", "hunter2", "different"), true);
});

test("safeNextPath: allows local paths, rejects open-redirect vectors", () => {
  assert.equal(safeNextPath("/rewards"), "/rewards");
  assert.equal(safeNextPath("/review?x=1"), "/review?x=1");
  assert.equal(safeNextPath(undefined), "/");
  assert.equal(safeNextPath(""), "/");
  assert.equal(safeNextPath("//evil.com"), "/");
  assert.equal(safeNextPath("https://evil.com"), "/");
  assert.equal(safeNextPath("/\\evil.com"), "/");
  assert.equal(safeNextPath("evil.com"), "/");
  assert.equal(safeNextPath("/login"), "/"); // no auth-loop
  assert.equal(safeNextPath("/logout"), "/");
  assert.equal(safeNextPath("/path\nwith-newline"), "/");
});

test("rate limiter: trips after the failure threshold, clears on reset", () => {
  _resetRateLimiterForTests();
  const ip = "203.0.113.7";
  assert.equal(isRateLimited(ip), false);
  for (let i = 0; i < 10; i++) recordFailure(ip);
  assert.equal(isRateLimited(ip), true);
  clearFailures(ip);
  assert.equal(isRateLimited(ip), false);
});

test("rate limiter: window expiry resets the count", () => {
  _resetRateLimiterForTests();
  const ip = "203.0.113.8";
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) recordFailure(ip, t0);
  assert.equal(isRateLimited(ip, t0), true);
  const later = t0 + 16 * 60 * 1000; // past the 15-min window
  assert.equal(isRateLimited(ip, later), false);
});

test("clientIp: prefers CF-Connecting-IP, falls back to XFF", () => {
  assert.equal(
    clientIp(new Headers({ "cf-connecting-ip": "198.51.100.5" })),
    "198.51.100.5"
  );
  assert.equal(
    clientIp(new Headers({ "x-forwarded-for": "198.51.100.9, 10.0.0.1" })),
    "198.51.100.9"
  );
  assert.equal(clientIp(new Headers()), "unknown");
});

// --- session cookie attributes (issue #21) --------------------------------

test("session cookie is HttpOnly + SameSite=Lax + path / in every environment", () => {
  for (const env of ["production", "development", "test", undefined]) {
    const opts = sessionCookieOptions(SESSION_MAX_AGE_S, env);
    assert.equal(opts.httpOnly, true);
    assert.equal(opts.sameSite, "lax");
    assert.equal(opts.path, "/");
    assert.equal(opts.maxAge, SESSION_MAX_AGE_S);
  }
});

test("session cookie is Secure in production", () => {
  assert.equal(sessionCookieOptions(SESSION_MAX_AGE_S, "production").secure, true);
});

test("session cookie is not Secure outside production (http://localhost dev)", () => {
  assert.equal(sessionCookieOptions(SESSION_MAX_AGE_S, "development").secure, false);
  assert.equal(sessionCookieOptions(SESSION_MAX_AGE_S, undefined).secure, false);
});

test("the logout cookie clears with the same attributes (maxAge 0)", () => {
  const clear = sessionCookieOptions(0, "production");
  const set = sessionCookieOptions(SESSION_MAX_AGE_S, "production");
  assert.equal(clear.maxAge, 0);
  assert.equal(clear.httpOnly, set.httpOnly);
  assert.equal(clear.secure, set.secure);
  assert.equal(clear.sameSite, set.sameSite);
  assert.equal(clear.path, set.path);
});
