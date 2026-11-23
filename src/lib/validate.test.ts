import { test } from "node:test";
import assert from "node:assert/strict";
import { parseId, parseIntInRange } from "./validate.ts";

test("parseId: digits only, positive, safe", () => {
  assert.equal(parseId("1"), 1);
  assert.equal(parseId("42"), 42);
  for (const bad of ["0", "-1", "1.5", "1e3", " 7", "07", "abc", "", "99999999999999999"]) {
    assert.equal(parseId(bad), null, bad);
  }
});

test("parseIntInRange: numbers and numeric strings in range only", () => {
  assert.equal(parseIntInRange(5, 1, 10), 5);
  assert.equal(parseIntInRange("10", 1, 10), 10);
  assert.equal(parseIntInRange(0, 0, 10), 0);
  for (const bad of [0, 11, 1.5, "", " ", null, undefined, true, false, [], [3], {}, "x", NaN, Infinity]) {
    assert.equal(parseIntInRange(bad, 1, 10), null, String(bad));
  }
});

test("parseDescription: optional, trimmed, blank -> null, max 500", async () => {
  const { parseDescription } = await import("./validate.ts");
  assert.equal(parseDescription(undefined), null);
  assert.equal(parseDescription(null), null);
  assert.equal(parseDescription("   "), null);
  assert.equal(parseDescription("  Before breakfast  "), "Before breakfast");
  assert.equal(parseDescription("x".repeat(500)), "x".repeat(500));
  assert.equal(parseDescription(`  ${"x".repeat(500)}  `), "x".repeat(500));
  assert.equal(parseDescription("x".repeat(501)), undefined);
  for (const bad of [5, true, [], {}]) assert.equal(parseDescription(bad), undefined);
});
