// Integration tests for the Next.js middleware: origin HTTPS enforcement
// (issue #21) and the ordering guarantees around the existing gates.
//
// Run with: npm test  (node --test, native TS type-stripping; no runner dep).
//
// The middleware is production code that imports `next/server` and the `@/`
// path alias — neither of which plain Node resolves — so this file registers
// module-resolution hooks (Node >= 22.15 / 24) before dynamically importing
// it. The hooks are process-local and `node --test` runs each test file in its
// own process, so nothing else is affected. This is worth the small amount of
// machinery: it tests the REAL middleware, including the order in which the
// HTTPS redirect, the CSRF/origin pin and the password gate run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { HSTS_VALUE } from "./lib/https.ts";

const SRC = pathToFileURL(`${import.meta.dirname}/`).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Next publishes the entry point as `next/server.js` on disk.
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    // The `@/*` -> `src/*` alias from tsconfig.json.
    if (specifier.startsWith("@/")) {
      return nextResolve(`${SRC}${specifier.slice(2)}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { middleware } = await import("./middleware.ts");
const { NextRequest } = await import("next/server.js");

const HOST = "todoist-points.graham-williams.com";
// The container's internal bind address: what `req.url` looks like inside the
// Next standalone server behind the tunnel. If it ever leaks into a Location
// header the browser gets ERR_CONNECTION_REFUSED (the PR #13 bug).
const INTERNAL = "http://0.0.0.0:3000";

function reset(): void {
  delete process.env.APP_HOST;
  delete process.env.APP_PASSWORD;
  delete process.env.SESSION_SECRET;
  delete process.env.CF_ACCESS_AUD;
  delete process.env.CF_ACCESS_TEAM_DOMAIN;
}

function request(
  path: string,
  headers: Record<string, string> = {},
  init: { method?: string } = {}
): InstanceType<typeof NextRequest> {
  return new NextRequest(`${INTERNAL}${path}`, { headers, ...init });
}

// A plain-http request as it arrives from the tunnel: the visitor's scheme in
// X-Forwarded-Proto, the public hostname in Host.
const HTTP_VISITOR = { "x-forwarded-proto": "http", host: HOST };

test("X-Forwarded-Proto: http → 301 to https on the pinned host", async () => {
  reset();
  process.env.APP_HOST = HOST;
  const res = await middleware(request("/review", HTTP_VISITOR));
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), `https://${HOST}/review`);
});

test("the redirect preserves query and percent-encoding", async () => {
  reset();
  process.env.APP_HOST = HOST;
  const res = await middleware(
    request("/review/a%20b?next=%2Fx%20y&n=1%2B2", HTTP_VISITOR)
  );
  assert.equal(res.status, 301);
  // Nothing is decoded or re-encoded on the way through: %2F stays %2F (it must
  // NOT become a path separator) and %2B stays %2B.
  assert.equal(
    res.headers.get("location"),
    `https://${HOST}/review/a%20b?next=%2Fx%20y&n=1%2B2`
  );
  // Caveat measured against the BUILT standalone server (not reproducible from
  // a hand-built NextRequest): there Next re-serializes `%20` as `+` in the
  // QUERY before middleware runs, so the live Location reads `next=%2Fx+y`.
  // Equivalent for query semantics, and nothing this code does or can undo.
});

test("the redirect never reflects the request Host and never leaks 0.0.0.0", async () => {
  reset();
  process.env.APP_HOST = HOST;

  // A crafted Host doesn't match APP_HOST, so it doesn't even redirect...
  const crafted = await middleware(
    request("/", { "x-forwarded-proto": "http", host: "evil.example" })
  );
  assert.notEqual(crafted.status, 301);
  assert.equal(crafted.headers.get("location"), null);

  // ...and a genuine request's target is APP_HOST, not req.url's 0.0.0.0:3000.
  const location = (await middleware(request("/", HTTP_VISITOR))).headers.get("location")!;
  assert.equal(location, `https://${HOST}/`);
  assert.ok(!location.includes("evil.example"));
  assert.ok(!location.includes("0.0.0.0"));
});

test("an in-network probe is served normally even with a synthesized proto header", async () => {
  // The Next server synthesizes `x-forwarded-proto: http` for a direct
  // http://localhost:3000 call, so the deploy healthcheck would 301 (and fail,
  // it asserts 200) if the Host guard weren't there. Verified against the
  // built standalone server, not just here.
  reset();
  process.env.APP_HOST = HOST;
  process.env.APP_PASSWORD = "shared-password";
  process.env.SESSION_SECRET = "test-secret";
  const res = await middleware(
    request("/api/health", { "x-forwarded-proto": "http", host: "localhost:3000" })
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("location"), null);
});

test("X-Forwarded-Proto: https is served normally", async () => {
  reset();
  process.env.APP_HOST = HOST;
  const res = await middleware(request("/", { "x-forwarded-proto": "https" }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("location"), null);
});

test("no X-Forwarded-Proto header: /api/health is served normally", async () => {
  // The documented deploy sanity check runs in-network and sends no forwarded
  // headers. It must get the health response, never a redirect.
  reset();
  process.env.APP_HOST = HOST;
  process.env.APP_PASSWORD = "shared-password";
  process.env.SESSION_SECRET = "test-secret";
  const res = await middleware(request("/api/health"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("location"), null);
});

test("no redirect when APP_HOST is unset (local dev / CI)", async () => {
  reset();
  const res = await middleware(request("/", HTTP_VISITOR));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("location"), null);
});

test("HTTPS enforcement runs BEFORE the password gate", async () => {
  // A plain-http visitor must be bounced to https rather than served the
  // login page (and its form) in the clear.
  reset();
  process.env.APP_HOST = HOST;
  process.env.APP_PASSWORD = "shared-password";
  process.env.SESSION_SECRET = "test-secret";
  const res = await middleware(request("/review", HTTP_VISITOR));
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), `https://${HOST}/review`);
});

test("HTTPS enforcement runs BEFORE the CSRF/origin pin", async () => {
  // Same-host POST over plain http: the origin pin would let it through (the
  // Host matches), so the 301 proves the https check ran first.
  reset();
  process.env.APP_HOST = HOST;
  const res = await middleware(
    request("/api/sync", HTTP_VISITOR, { method: "POST" })
  );
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), `https://${HOST}/api/sync`);
});

test("the password gate still redirects an unauthenticated visitor to /login", async () => {
  reset();
  process.env.APP_HOST = HOST;
  process.env.APP_PASSWORD = "shared-password";
  process.env.SESSION_SECRET = "test-secret";
  const res = await middleware(request("/review?a=1", { "x-forwarded-proto": "https" }));
  assert.equal(res.status, 307);
  assert.ok(res.headers.get("location")!.includes("/login?next=%2Freview%3Fa%3D1"));
});

test("HSTS is on every response path", async () => {
  reset();
  process.env.APP_HOST = HOST;
  process.env.APP_PASSWORD = "shared-password";
  process.env.SESSION_SECRET = "test-secret";

  // 1. the https redirect
  const redirected = await middleware(request("/", HTTP_VISITOR));
  assert.equal(redirected.status, 301);
  assert.equal(redirected.headers.get("strict-transport-security"), HSTS_VALUE);

  // 2. a normal (passed-through) response
  const passthrough = await middleware(request("/api/health", { "x-forwarded-proto": "https" }));
  assert.equal(passthrough.status, 200);
  assert.equal(passthrough.headers.get("strict-transport-security"), HSTS_VALUE);

  // 3. the middleware's own short-circuit: /login redirect...
  const login = await middleware(request("/review", { "x-forwarded-proto": "https" }));
  assert.equal(login.status, 307);
  assert.equal(login.headers.get("strict-transport-security"), HSTS_VALUE);

  // ...4. the 401 for an unauthenticated API call...
  const unauthorized = await middleware(request("/api/sync", { "x-forwarded-proto": "https" }));
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("strict-transport-security"), HSTS_VALUE);

  // ...and 5. the 403 from the CSRF/origin pin.
  const forbidden = await middleware(
    request("/api/sync", { "x-forwarded-proto": "https", host: "evil.example" }, { method: "POST" })
  );
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get("strict-transport-security"), HSTS_VALUE);
});

test("HSTS value is exactly one year, no includeSubDomains/preload", async () => {
  reset();
  const res = await middleware(request("/"));
  assert.equal(res.headers.get("strict-transport-security"), "max-age=31536000");
});
