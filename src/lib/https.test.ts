// Unit tests for the origin HTTPS-enforcement helpers (issue #21).
// Run with: npm test  (node --test, native TS type-stripping; no runner dep).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HSTS_HEADER,
  HSTS_VALUE,
  HTTPS_REDIRECT_HEADERS,
  HTTPS_REDIRECT_STATUS,
  addVary,
  cfVisitorScheme,
  hasCloudflareSignal,
  httpsRedirectTarget,
  isForwardedPlainHttp,
  isSafeRedirectHost,
} from "./https.ts";
import type { HttpsRedirectInput } from "./https.ts";

const HOST = "todoist-points.graham-williams.com";

// A request as it really arrives from the tunnel: Cloudflare's own markers,
// the visitor's scheme, and the public hostname. Tests override one field at
// a time so it's obvious which condition each one is exercising.
function input(overrides: Partial<HttpsRedirectInput> = {}): HttpsRedirectInput {
  return {
    forwardedProto: "http",
    requestHost: HOST,
    cfConnectingIp: "203.0.113.9",
    cfVisitor: null,
    appHost: HOST,
    pathname: "/review",
    search: "",
    ...overrides,
  };
}

test("HSTS header is one year, without includeSubDomains or preload", () => {
  assert.equal(HSTS_HEADER, "Strict-Transport-Security");
  assert.equal(HSTS_VALUE, "max-age=31536000");
});

test("the redirect is a TEMPORARY, uncacheable 307 — never a 301", () => {
  // A 301 is cached by browsers (and by Cloudflare for cacheable extensions),
  // so a scheme redirect issued in error would outlive its own fix. 307 also
  // preserves the method, so a plain-http POST is re-sent over https rather
  // than silently downgraded to a bodiless GET.
  assert.equal(HTTPS_REDIRECT_STATUS, 307);
  assert.equal(HTTPS_REDIRECT_HEADERS["Cache-Control"], "no-store");
  assert.equal(HTTPS_REDIRECT_HEADERS["Vary"], "X-Forwarded-Proto");
});

test("a plain-http visitor through Cloudflare redirects to the pinned host", () => {
  assert.equal(httpsRedirectTarget(input()), `https://${HOST}/review`);
});

// ---------------------------------------------------------------------------
// (1) The Cloudflare-marker requirement — the fail-open guard.
// ---------------------------------------------------------------------------

test("NO Cloudflare marker → fail OPEN, never redirect", () => {
  // THE LOOP CASE. The Next standalone server SYNTHESIZES
  // `x-forwarded-proto: http` when the client omitted it, so a proto-only
  // rule redirects an https request that arrived without forwarded headers to
  // the URL it already asked for → an infinite redirect loop. Requiring a
  // Cloudflare marker is what makes that impossible: no marker, no redirect,
  // exactly like the four sibling Flask apps.
  assert.equal(
    httpsRedirectTarget(input({ cfConnectingIp: null, cfVisitor: null })),
    null
  );
  assert.equal(
    httpsRedirectTarget(input({ cfConnectingIp: undefined, cfVisitor: undefined })),
    null
  );
  // Empty / whitespace-only values are not markers either.
  assert.equal(httpsRedirectTarget(input({ cfConnectingIp: "" })), null);
  assert.equal(httpsRedirectTarget(input({ cfConnectingIp: "   " })), null);
  // ...and that holds even with the synthesized proto header present, which is
  // precisely the shape of the request that used to loop.
  assert.equal(
    httpsRedirectTarget(
      input({ forwardedProto: "http", cfConnectingIp: null, cfVisitor: null })
    ),
    null
  );
});

test("either Cloudflare marker on its own is enough", () => {
  assert.equal(hasCloudflareSignal("203.0.113.9", null), true);
  assert.equal(hasCloudflareSignal(null, '{"scheme":"http"}'), true);
  assert.equal(hasCloudflareSignal(null, null), false);
  assert.equal(hasCloudflareSignal("", ""), false);
  // An unparseable CF-Visitor is not a marker.
  assert.equal(hasCloudflareSignal(null, "not json"), false);
  assert.equal(hasCloudflareSignal(null, '{"scheme":"gopher"}'), false);

  // CF-Visitor alone still redirects.
  assert.equal(
    httpsRedirectTarget(
      input({ cfConnectingIp: null, cfVisitor: '{"scheme":"http"}', forwardedProto: null })
    ),
    `https://${HOST}/review`
  );
});

// ---------------------------------------------------------------------------
// (2) The scheme decision.
// ---------------------------------------------------------------------------

test("CF-Visitor is authoritative over X-Forwarded-Proto", () => {
  assert.equal(cfVisitorScheme('{"scheme":"https"}'), "https");
  assert.equal(cfVisitorScheme('{"scheme":"HTTP"}'), "http");
  assert.equal(cfVisitorScheme("{}"), null);
  assert.equal(cfVisitorScheme("["), null);
  assert.equal(cfVisitorScheme(null), null);
  assert.equal(cfVisitorScheme(`{"scheme":"${"a".repeat(300)}"}`), null); // oversized

  // CF says https, a stale/synthesized XFP says http → no redirect.
  assert.equal(
    httpsRedirectTarget(input({ forwardedProto: "http", cfVisitor: '{"scheme":"https"}' })),
    null
  );
  // CF says http, XFP says https → redirect.
  assert.equal(
    httpsRedirectTarget(input({ forwardedProto: "https", cfVisitor: '{"scheme":"http"}' })),
    `https://${HOST}/review`
  );
});

test("an oversized CF-Visitor is ignored even when it parses", () => {
  // The 256-byte cap is a DoS guard in front of JSON.parse. The pre-existing
  // oversized case used a junk scheme, so it returned null with or without the
  // cap — it never pinned it. These two do: the payload is a *genuine*
  // {"scheme":"https"} with padding, so deleting the cap changes the answer.
  const padded = (total: number) =>
    `{"scheme":"https","pad":"${"a".repeat(total - 27)}"}`;

  const over = padded(300);
  assert.equal(over.length, 300);
  assert.equal(JSON.parse(over).scheme, "https"); // it really is parseable
  assert.equal(cfVisitorScheme(over), null); // …and still refused

  // Consequence, end to end: the oversized header contributes NOTHING, so the
  // decision falls back to X-Forwarded-Proto and the http request redirects.
  // Without the cap, CF-Visitor would say "https" and this would be null.
  assert.equal(
    httpsRedirectTarget(input({ forwardedProto: "http", cfVisitor: over })),
    `https://${HOST}/review`
  );

  // Companion: a value right AT the cap is still honoured, so the guard can't
  // be "fixed" by tightening it until real Cloudflare headers stop working.
  const atCap = padded(256);
  assert.equal(atCap.length, 256);
  assert.equal(cfVisitorScheme(atCap), "https");
  assert.equal(
    httpsRedirectTarget(input({ forwardedProto: "http", cfVisitor: atCap })),
    null
  );
});

test("scheme match is case/whitespace insensitive", () => {
  assert.equal(isForwardedPlainHttp("HTTP"), true);
  assert.equal(isForwardedPlainHttp(" http "), true);
  assert.equal(isForwardedPlainHttp("https"), false);
  // Multi-hop list is ambiguous → treated as "not plainly http".
  assert.equal(isForwardedPlainHttp("http, https"), false);
  assert.equal(httpsRedirectTarget(input({ forwardedProto: " HTTP " })), `https://${HOST}/review`);
  assert.equal(httpsRedirectTarget(input({ forwardedProto: "http, https" })), null);
});

test("X-Forwarded-Proto: https is left alone", () => {
  assert.equal(httpsRedirectTarget(input({ forwardedProto: "https" })), null);
});

// ---------------------------------------------------------------------------
// (3) The Host guard and the target.
// ---------------------------------------------------------------------------

test("no redirect when APP_HOST is unset/empty (local dev + CI fail open)", () => {
  assert.equal(httpsRedirectTarget(input({ appHost: undefined })), null);
  assert.equal(httpsRedirectTarget(input({ appHost: "" })), null);
});

test("path and query are copied through untouched, percent-encoding included", () => {
  // (Next re-serializes `%20` as `+` in the QUERY before middleware sees it —
  // see the note on httpsRedirectTarget. This helper changes nothing itself.)
  assert.equal(
    httpsRedirectTarget(
      input({ pathname: "/review%2Fdeep/a%20b", search: "?next=%2Fa%20b&x=1%2B2" })
    ),
    `https://${HOST}/review%2Fdeep/a%20b?next=%2Fa%20b&x=1%2B2`
  );
});

test("empty path/query are handled", () => {
  assert.equal(httpsRedirectTarget(input({ pathname: "/", search: "" })), `https://${HOST}/`);
  // A bare (schemeless) query string still gets its "?".
  assert.equal(
    httpsRedirectTarget(input({ pathname: "/", search: "a=1" })),
    `https://${HOST}/?a=1`
  );
});

test("a crafted Host header is never reflected — the target is always APP_HOST", () => {
  // A mismatched Host doesn't redirect at all, and can never reach the target.
  assert.equal(httpsRedirectTarget(input({ requestHost: "evil.example" })), null);
  const target = httpsRedirectTarget(input({ search: "?a=1" }));
  assert.ok(target!.startsWith(`https://${HOST}/`));
  assert.ok(!target!.includes("evil.example"));
});

test("an in-network request (Host: localhost:3000) is never redirected", () => {
  // THE DEPLOY-BREAKING CASE. The documented sanity check is
  //   docker compose exec todoist-points node -e \
  //     "fetch('http://localhost:3000/api/health')...(exit r.status===200?0:1)"
  // It carries no Cloudflare markers (rule 1 already lets it through) AND a
  // non-matching Host, so two independent guards keep it at 200.
  assert.equal(
    httpsRedirectTarget(
      input({ requestHost: "localhost:3000", pathname: "/api/health", cfConnectingIp: null })
    ),
    null
  );
  // Even if something inside the network did carry a marker, the Host guard
  // still holds on its own.
  assert.equal(
    httpsRedirectTarget(input({ requestHost: "localhost:3000", pathname: "/api/health" })),
    null
  );
  assert.equal(httpsRedirectTarget(input({ requestHost: "127.0.0.1:3000", pathname: "/" })), null);
  assert.equal(httpsRedirectTarget(input({ requestHost: null })), null);
});

test("the Host guard is case-insensitive", () => {
  assert.equal(
    httpsRedirectTarget(input({ requestHost: HOST.toUpperCase(), pathname: "/" })),
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
    assert.equal(
      httpsRedirectTarget(input({ requestHost: bad, appHost: bad, pathname: "/" })),
      null,
      `expected no redirect: ${bad}`
    );
  }
});

test("host with an explicit port is allowed", () => {
  // The `:port` allowance is this repo's deliberate difference from the four
  // Flask siblings and must keep working. NOTE the host part still needs a dot
  // (B1 below), so this can no longer be spelled `localhost:3000`.
  assert.equal(isSafeRedirectHost("staging.example.test:3000"), true);
  assert.equal(isSafeRedirectHost("todoist-points.graham-williams.com:443"), true);
  assert.equal(
    httpsRedirectTarget(
      input({
        requestHost: "staging.example.test:3000",
        appHost: "staging.example.test:3000",
        pathname: "/x",
      })
    ),
    "https://staging.example.test:3000/x"
  );
});

// --- B1: a public origin pin always has a dot --------------------------------
//
// Found by the break-staging exploratory-QA sweep, 2026-09-19. `localhost` and
// bare IP literals USED TO VALIDATE, which is exactly why the bug was silent:
// APP_HOST=localhost handed every plain-http visitor a live
// `Location: https://localhost/…` — broken for everyone — instead of tripping
// the loud fail-open branch. Such values now fail open, which is diagnosable.

test("B1: a public origin pin must have a dot and must not be a bare IP", () => {
  // Strictly a TIGHTENING: every host this app actually uses still passes,
  // including the `:port` form.
  for (const good of [
    HOST,
    "graham-williams.com",
    "todoist-points.example.test",
    "dashboard.ci.example",
    "a.b",
    "staging.example.test:3000",
    `${HOST}:443`,
  ]) {
    assert.equal(isSafeRedirectHost(good), true, `expected safe: ${good}`);
  }
  for (const bad of [
    // single-label values — a compose service name or the dev default
    "localhost",
    "localhost:3000",
    "x",
    "todoist-points",
    "app",
    // bare IPv4 literals, with and without a port
    "127.0.0.1",
    "127.0.0.1:3000",
    "0.0.0.0",
    "192.168.1.1",
    "255.255.255.255",
    "100.101.1.28", // the box's own tailnet address
    // an all-digits final label is not a hostname either (matches the Flask
    // siblings' `\.(?![0-9]+\Z)` rule)
    "example.123",
    "foo.42:8080",
    // IPv6 was never accepted: ':' is only ever the port separator here
    "::1",
    "[::1]",
  ]) {
    assert.equal(isSafeRedirectHost(bad), false, `expected unsafe: ${bad}`);
  }
});

test("B1: a dotless or bare-IP APP_HOST fails open rather than redirecting", () => {
  // The whole point of the fix: these land in the fail-open branch instead of
  // producing a live redirect to a hostname no browser can resolve.
  for (const bad of ["localhost", "127.0.0.1", "todoist-points"]) {
    assert.equal(
      httpsRedirectTarget(input({ requestHost: bad, appHost: bad, pathname: "/" })),
      null,
      `expected no redirect: ${bad}`
    );
  }
});

test("control characters in the path can't inject a header", () => {
  const target = httpsRedirectTarget(
    input({ pathname: "/a\r\nX-Injected: 1", search: "?b= c" })
  );
  assert.equal(target, `https://${HOST}/a%0D%0AX-Injected:%201?b=%20c`);
  assert.ok(!target!.includes("\r"));
  assert.ok(!target!.includes("\n"));
});


// --- B2: Vary is two-sided ---------------------------------------------------
//
// Found by the break-staging exploratory-QA sweep, 2026-09-19.
// `Vary: X-Forwarded-Proto` was set on the 307 ONLY. The 200s/302s whose
// content that redirect decision gates are equally scheme-dependent, so a
// shared cache could store an https-served 200 and later hand it to a
// plain-http request. `addVary` is the append primitive that fixes it; the
// response-path coverage lives in src/middleware.test.ts.

function vary(value: string | null): Headers {
  const h = new Headers();
  if (value !== null) h.set("Vary", value);
  return h;
}

test("B2: addVary sets Vary when there is none", () => {
  const h = vary(null);
  addVary(h, "X-Forwarded-Proto");
  assert.equal(h.get("Vary"), "X-Forwarded-Proto");

  const blank = vary("   ");
  addVary(blank, "X-Forwarded-Proto");
  assert.equal(blank.get("Vary"), "X-Forwarded-Proto");
});

test("B2: addVary APPENDS — it never clobbers an existing value", () => {
  // ⚠️ The regression this guards: `headers.set("Vary", "X-Forwarded-Proto")`
  // DROPS a Vary already on the response. The session layer adds
  // `Vary: Cookie`, so assignment would break session caching.
  const h = vary("Cookie");
  addVary(h, "X-Forwarded-Proto");
  assert.equal(h.get("Vary"), "Cookie, X-Forwarded-Proto");

  const multi = vary("Cookie, Accept-Encoding");
  addVary(multi, "X-Forwarded-Proto");
  assert.equal(multi.get("Vary"), "Cookie, Accept-Encoding, X-Forwarded-Proto");
});

test("B2: addVary is idempotent and case-insensitive", () => {
  const h = vary("X-Forwarded-Proto");
  addVary(h, "X-Forwarded-Proto");
  addVary(h, "X-Forwarded-Proto");
  assert.equal(h.get("Vary"), "X-Forwarded-Proto");

  // Field names are case-insensitive, so a differently-cased existing token
  // must not be duplicated.
  const cased = vary("x-forwarded-proto");
  addVary(cased, "X-Forwarded-Proto");
  assert.equal(cased.get("Vary"), "x-forwarded-proto");

  const withCookie = vary("Cookie, x-forwarded-proto");
  addVary(withCookie, "X-Forwarded-Proto");
  assert.equal(withCookie.get("Vary"), "Cookie, x-forwarded-proto");
});

test("B2: addVary leaves `Vary: *` alone — it already covers everything", () => {
  const h = vary("*");
  addVary(h, "X-Forwarded-Proto");
  assert.equal(h.get("Vary"), "*");
});
