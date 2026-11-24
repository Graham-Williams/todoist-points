// Unit tests for the point display helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPoints, formatSignedPoints, parseBalanceDraft } from "./points.ts";

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

test("balance drafts: negatives (hyphen or U+2212) are accepted within range", () => {
  assert.equal(parseBalanceDraft("-50", 1000000), -50);
  assert.equal(parseBalanceDraft("\u221250", 1000000), -50);
  assert.equal(parseBalanceDraft(String(-22), 1000000), -22); // the pre-fill
  assert.equal(parseBalanceDraft(" 12 ", 1000000), 12);
  assert.equal(parseBalanceDraft("0", 1000000), 0);
  assert.equal(parseBalanceDraft("-1000000", 1000000), -1000000);
  for (const bad of ["", "-", "--5", "1.5", "-2.5", "1e3", "abc", "5-", "-1000001", "1000001"]) {
    assert.equal(parseBalanceDraft(bad, 1000000), null, bad);
  }
});
