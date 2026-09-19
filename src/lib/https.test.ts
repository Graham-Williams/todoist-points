// Unit tests for the origin HTTPS-enforcement helpers (issue #21).
// Run with: npm test  (node --test, native TS type-stripping; no runner dep).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HSTS_HEADER,
  HSTS_VALUE,
  httpsRedirectTarget,
  isForwardedPlainHttp,
  isSafeRedirectHost,
} from "./https.ts";

const HOST = "todoist-points.graham-williams.com";

test("HSTS header is one year, without includeSubDomains or preload", () => {
  assert.equal(HSTS_HEADER, "Strict-Transport-Security");
  assert.equal(HSTS_VALUE, "max-age=31536000");
});

test("X-Forwarded-Proto: http redirects to the pinned host", () => {
  assert.equal(
    httpsRedirectTarget("http", HOST, HOST, "/review", ""),
    `https://${HOST}/review`
  );
});

test("scheme match is case/whitespace insensitive", () => {
  assert.equal(isForwardedPlainHttp("HTTP"), true);
  assert.equal(isForwardedPlainHttp(" http "), true);
  assert.equal(isForwardedPlainHttp("https"), false);
  // Multi-hop list is ambiguous → treated as "not plainly http".
  assert.equal(isForwardedPlainHttp("http, https"), false);
});

test("X-Forwarded-Proto: https is left alone", () => {
  assert.equal(httpsRedirectTarget("https", HOST, HOST, "/review", ""), null);
});

test("a MISSING X-Forwarded-Proto never redirects", () => {
  // NOTE the Next server synthesizes this header when the client omits it, so
  // in practice the in-network healthcheck is caught by the Host guard below,
  // not by this branch. Both must hold.
  assert.equal(httpsRedirectTarget(null, HOST, HOST, "/api/health", ""), null);
  assert.equal(httpsRedirectTarget(undefined, HOST, HOST, "/api/health", ""), null);
  assert.equal(httpsRedirectTarget("", HOST, HOST, "/api/health", ""), null);
});

test("no redirect when APP_HOST is unset/empty (local dev + CI fail open)", () => {
  assert.equal(httpsRedirectTarget("http", HOST, undefined, "/review", ""), null);
  assert.equal(httpsRedirectTarget("http", HOST, "", "/review", ""), null);
});

test("path and query are copied through untouched, percent-encoding included", () => {
  // (Next re-serializes `%20` as `+` in the QUERY before middleware sees it —
  // see the note on httpsRedirectTarget. This helper changes nothing itself.)
  assert.equal(
    httpsRedirectTarget("http", HOST, HOST, "/review%2Fdeep/a%20b", "?next=%2Fa%20b&x=1%2B2"),
    `https://${HOST}/review%2Fdeep/a%20b?next=%2Fa%20b&x=1%2B2`
  );
});

test("empty path/query are handled", () => {
  assert.equal(httpsRedirectTarget("http", HOST, HOST, "/", ""), `https://${HOST}/`);
  // A bare (schemeless) query string still gets its "?".
  assert.equal(httpsRedirectTarget("http", HOST, HOST, "/", "a=1"), `https://${HOST}/?a=1`);
});

test("a crafted Host header is never reflected — the target is always APP_HOST", () => {
  // A mismatched Host doesn't redirect at all, and can never reach the target.
  assert.equal(httpsRedirectTarget("http", "evil.example", HOST, "/review", "?a=1"), null);
  const target = httpsRedirectTarget("http", HOST, HOST, "/review", "?a=1");
  assert.ok(target!.startsWith(`https://${HOST}/`));
  assert.ok(!target!.includes("evil.example"));
});

test("an in-network request (Host: localhost:3000) is never redirected", () => {
  // THE DEPLOY-BREAKING CASE. The documented sanity check is
  //   docker compose exec todoist-points node -e \
  //     "fetch('http://localhost:3000/api/health')...(exit r.status===200?0:1)"
  // and the Next server hands middleware a synthesized `x-forwarded-proto:
  // http` for it, so only the Host guard keeps it at 200.
  assert.equal(
    httpsRedirectTarget("http", "localhost:3000", HOST, "/api/health", ""),
    null
  );
  assert.equal(httpsRedirectTarget("http", "127.0.0.1:3000", HOST, "/", ""), null);
  assert.equal(httpsRedirectTarget("http", null, HOST, "/api/health", ""), null);
});

test("the Host guard is case-insensitive", () => {
  assert.equal(
    httpsRedirectTarget("http", HOST.toUpperCase(), HOST, "/", ""),
    `https://${HOST}/`
  );
});

test("a malformed APP_HOST fails open instead of becoming an open redirect", () => {
  for (const bad of [
    "evil.example/path",
    "//evil.example",
    "https://evil.example",
    "user@evil.example",
    "evil.example\\x",
    "evil example",
    "evil.example\r\nX-Injected: 1",
    ":",
  ]) {
    assert.equal(isSafeRedirectHost(bad), false, `expected unsafe: ${bad}`);
    assert.equal(httpsRedirectTarget("http", bad, bad, "/", ""), null, `expected no redirect: ${bad}`);
  }
});

test("host with an explicit port is allowed", () => {
  assert.equal(isSafeRedirectHost("localhost:3000"), true);
  assert.equal(
    httpsRedirectTarget("http", "localhost:3000", "localhost:3000", "/x", ""),
    "https://localhost:3000/x"
  );
});

test("control characters in the path can't inject a header", () => {
  const target = httpsRedirectTarget("http", HOST, HOST, "/a\r\nX-Injected: 1", "?b= c");
  assert.equal(target, `https://${HOST}/a%0D%0AX-Injected:%201?b=%20c`);
  assert.ok(!target!.includes("\r"));
  assert.ok(!target!.includes("\n"));
});
