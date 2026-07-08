// Unit tests for the earning-source suffix parser.
// Run with: npm test  (node --test, native TS type-stripping; no runner dep).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEarning } from "./earningSource.ts";

test("manual-review suffix -> clean title + manual badge", () => {
  const r = parseEarning("Take out the trash (manual review)");
  assert.equal(r.title, "Take out the trash");
  assert.deepEqual(r.badges, [{ kind: "manual", text: "manual review" }]);
});

test("pre-assigned suffix -> clean title + pre-assigned badge", () => {
  const r = parseEarning("Book flights (pre-assigned)");
  assert.equal(r.title, "Book flights");
  assert.deepEqual(r.badges, [{ kind: "pre-assigned", text: "pre-assigned" }]);
});

test("single label -> clean title + one label badge", () => {
  const r = parseEarning("Do dishes [chores]");
  assert.equal(r.title, "Do dishes");
  assert.deepEqual(r.badges, [{ kind: "label", text: "chores" }]);
});

test("multiple labels -> one badge each, trimmed", () => {
  const r = parseEarning("Ship feature [work, urgent]");
  assert.equal(r.title, "Ship feature");
  assert.deepEqual(r.badges, [
    { kind: "label", text: "work" },
    { kind: "label", text: "urgent" },
  ]);
});

test("no recognizable suffix -> title unchanged, no badges", () => {
  const r = parseEarning("Plain task");
  assert.equal(r.title, "Plain task");
  assert.deepEqual(r.badges, []);
});

test("null description is handled", () => {
  const r = parseEarning(null);
  assert.equal(r.title, "");
  assert.deepEqual(r.badges, []);
});

test("only the trailing bracket group is stripped; earlier brackets stay", () => {
  const r = parseEarning("Fix bug [v2] in parser [work]");
  assert.equal(r.title, "Fix bug [v2] in parser");
  assert.deepEqual(r.badges, [{ kind: "label", text: "work" }]);
});

test("empty bracket group is not treated as a label", () => {
  const r = parseEarning("Weird title []");
  assert.equal(r.title, "Weird title []");
  assert.deepEqual(r.badges, []);
});
