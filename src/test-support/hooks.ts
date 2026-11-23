// Test-only harness: lets plain `node --test` import real app modules (route
// handlers, queries.ts, db.ts) against a throwaway SQLite file.
//
// Import this FIRST (as a side-effect import), then load app code with a
// dynamic `await import(...)` so the hooks are in place before resolution:
//
//   import "../test-support/hooks.ts";
//   const q = await import("../lib/queries.ts");
//
// What it does:
//  - Registers module-resolution hooks (same idea as src/proxy.test.ts) for the
//    `@/` alias, `next/server`, and the extensionless relative imports that
//    Next's bundler resolves but plain Node does not (`./db` -> `./db.ts`).
//  - Points DB_PATH at a fresh temp file (removed on exit), so db.ts's lazy
//    getDb() creates the real schema there and never touches ./data.
// `node --test` runs each test file in its own process, so every file gets its
// own DB and its own module-level connection.
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SRC = pathToFileURL(`${import.meta.dirname}/../`).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) {
      return nextResolve(`${SRC}${specifier.slice(2)}.ts`, context);
    }
    // Only for our own source files — never inside node_modules.
    if (
      context.parentURL?.startsWith(SRC) &&
      !context.parentURL.includes("/node_modules/") &&
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[cm]?[jt]sx?$/.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "todoist-points-test-"));
process.env.DB_PATH = path.join(dir, "test.db");
process.on("exit", () => {
  fs.rmSync(dir, { recursive: true, force: true });
});
