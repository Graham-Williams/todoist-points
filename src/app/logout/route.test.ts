// Integration test for GET/POST /logout's REAL redirect and `Set-Cookie`.
//
// Behind the Cloudflare tunnel the standalone server sees `req.url` with the
// container bind host (0.0.0.0:3000), so the redirect must be a RELATIVE
// `Location: /login` — an absolute one sends the browser to 0.0.0.0. The
// request below uses that host on purpose.
//
// Module-resolution hooks (see src/proxy.test.ts for the rationale) let
// plain Node import a file that uses `next/server` and the `@/` alias.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const SRC = pathToFileURL(`${import.meta.dirname}/../../`).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) {
      return nextResolve(`${SRC}${specifier.slice(2)}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { GET, POST } = await import("./route.ts");
const { NextRequest } = await import("next/server.js");

for (const [method, handler] of [
  ["GET", GET],
  ["POST", POST],
] as const) {
  test(`${method} /logout redirects to a relative /login and clears the session cookie`, () => {
    const prevEnv = process.env.NODE_ENV;
    // NODE_ENV is typed read-only by Next; the build type-checks this file.
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    try {
      const res = handler(
        new NextRequest("http://0.0.0.0:3000/logout", {
          method,
          headers: { cookie: "tp_session=v1.123.abc" },
        }),
      );

      assert.equal(res.status, 303);
      // Exactly the path: no scheme, no host (never 0.0.0.0).
      assert.equal(res.headers.get("location"), "/login");

      const setCookie = res.headers.get("set-cookie");
      assert.ok(setCookie, "expected a Set-Cookie header");
      const header = setCookie!.toLowerCase();
      assert.ok(header.startsWith("tp_session=;"), `cookie not blanked: ${setCookie}`);
      assert.ok(header.includes("; max-age=0"), `missing Max-Age=0: ${setCookie}`);
      // Same attributes as the login cookie, or the browser keeps the original.
      assert.ok(header.includes("; secure"), `missing Secure: ${setCookie}`);
      assert.ok(header.includes("; httponly"), `missing HttpOnly: ${setCookie}`);
      assert.ok(header.includes("; samesite=lax"), `missing SameSite=Lax: ${setCookie}`);
      assert.ok(header.includes("; path=/"), `missing Path=/: ${setCookie}`);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
    }
  });
}
