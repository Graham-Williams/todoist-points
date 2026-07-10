// Unit tests for the pure applyOrder reorder helper.
// Run with: npm test  (node --test, native TS type-stripping; no runner dep).
// applyOrder lives in its own dependency-free module so this test never pulls
// in the native better-sqlite3 import (queries.ts re-exports it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOrder } from "./order.ts";

interface Item {
  key: string;
}
const key = (i: Item) => i.key;
const items: Item[] = [{ key: "a" }, { key: "b" }, { key: "c" }];

test("empty order map preserves natural order", () => {
  const out = applyOrder(items, key, {});
  assert.deepEqual(out.map(key), ["a", "b", "c"]);
});

test("full order map reorders by position", () => {
  const out = applyOrder(items, key, { a: 2, b: 0, c: 1 });
  assert.deepEqual(out.map(key), ["b", "c", "a"]);
});

test("partial map: positioned first (in position order), rest in natural order", () => {
  // Only "c" has a stored position → it leads; "a","b" keep their input order.
  const out = applyOrder(items, key, { c: 0 });
  assert.deepEqual(out.map(key), ["c", "a", "b"]);
});

test("partial map with two positioned items keeps unpositioned tail stable", () => {
  const four: Item[] = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];
  const out = applyOrder(four, key, { d: 0, b: 1 });
  assert.deepEqual(out.map(key), ["d", "b", "a", "c"]);
});
