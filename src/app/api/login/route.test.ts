// Integration test for POST /api/login's REAL `Set-Cookie` header.
//
// `src/lib/auth.test.ts` already asserts the attributes returned by the pure
// `sessionCookieOptions()` helper. That is not quite the same claim: it proves
// the helper is right, not that the route uses it or that Next serializes it
// the way we expect. The four sibling Flask apps assert the live header, so
// this does too — one test, no new dependency.
//
// Module-resolution hooks (see src/middleware.test.ts for the rationale) let
// plain Node import a file that uses `next/server` and the `@/` alias.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const SRC = pathToFileURL(`${import.meta.dirname}/../../../`).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) {
      return nextResolve(`${SRC}${specifier.slice(2)}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { POST } = await import("./route.ts");
const { NextRequest } = await import("next/server.js");

const PASSWORD = "correct-horse-battery-staple";

function loginRequest(password: string): InstanceType<typeof NextRequest> {
  const body = new URLSearchParams({ password, next: "/review" });
  return new NextRequest("http://0.0.0.0:3000/api/login", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      // Keeps the per-IP failed-login limiter from seeing every test as one
      // client; this test only logs in successfully anyway.
      "cf-connecting-ip": "203.0.113.42",
    },
    body,
  });
}

test("POST /api/login sets a Secure, HttpOnly, SameSite=Lax session cookie in production", async () => {
  const prevEnv = process.env.NODE_ENV;
  process.env.APP_PASSWORD = PASSWORD;
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.NODE_ENV = "production";
  try {
    const res = await POST(loginRequest(PASSWORD));

    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/review");

    const setCookie = res.headers.get("set-cookie");
    assert.ok(setCookie, "expected a Set-Cookie header");
    // Attribute names are case-insensitive per RFC 6265; match case-insensitively
    // so a Next serialization change in casing doesn't fail the build spuriously.
    const header = setCookie!.toLowerCase();
    assert.ok(header.startsWith("tp_session="), `unexpected cookie: ${setCookie}`);
    assert.ok(header.includes("; secure"), `missing Secure: ${setCookie}`);
    assert.ok(header.includes("; httponly"), `missing HttpOnly: ${setCookie}`);
    assert.ok(header.includes("; samesite=lax"), `missing SameSite=Lax: ${setCookie}`);
    assert.ok(header.includes("; path=/"), `missing Path=/: ${setCookie}`);
    // The signed marker, never the password itself.
    assert.ok(!setCookie!.includes(PASSWORD), "the password must never reach the cookie");
    assert.match(setCookie!, /tp_session=v1\.\d+\./);
  } finally {
    process.env.NODE_ENV = prevEnv;
    delete process.env.APP_PASSWORD;
    delete process.env.SESSION_SECRET;
  }
});
