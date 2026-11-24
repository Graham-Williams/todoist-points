// Unit tests for the point display helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPoints, formatSignedPoints } from "./points.ts";

test("totals: negatives get a real minus sign, others are bare", () => {
  assert.equal(formatPoints(15), "15");
  assert.equal(formatPoints(0), "0");
  assert.equal(formatPoints(-15), "−15");
  assert.notEqual(formatPoints(-15), "-15"); // not a hyphen
});

test("changes: always signed", () => {
  assert.equal(formatSignedPoints(5), "+5");
  assert.equal(formatSignedPoints(-5), "−5");
  assert.equal(formatSignedPoints(0), "0");
});
