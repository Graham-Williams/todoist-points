// Unit tests for the legacy description-suffix stripper.
import { test } from "node:test";
import assert from "node:assert/strict";
import { earningTitle } from "./earningSource.ts";

test("manual-review suffix is stripped", () => {
  assert.equal(earningTitle("Take out the trash (manual review)"), "Take out the trash");
});

test("pre-assigned suffix is stripped", () => {
  assert.equal(earningTitle("Book flights (pre-assigned)"), "Book flights");
});

test("trailing label list is stripped (single and multiple)", () => {
  assert.equal(earningTitle("Do dishes [chores]"), "Do dishes");
  assert.equal(earningTitle("Ship feature [work, urgent]"), "Ship feature");
});

test("no recognizable suffix -> unchanged", () => {
  assert.equal(earningTitle("Plain task"), "Plain task");
  assert.equal(earningTitle("Habit: Stretch"), "Habit: Stretch");
});

test("null description is handled", () => {
  assert.equal(earningTitle(null), "");
});

test("only the trailing bracket group is stripped; earlier brackets stay", () => {
  assert.equal(earningTitle("Fix bug [v2] in parser [work]"), "Fix bug [v2] in parser");
});

test("empty bracket group is not treated as a label list", () => {
  assert.equal(earningTitle("Weird title []"), "Weird title []");
});
