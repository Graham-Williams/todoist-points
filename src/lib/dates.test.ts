// Unit tests for the habit date helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  daysBetween,
  isDateInCheckWindow,
  isValidDateStr,
  lastNLocalDates,
  localDateStr,
} from "./dates.ts";

test("isValidDateStr accepts real dates only, strict format", () => {
  for (const ok of ["2026-11-23", "2024-02-29", "2026-12-31", "2027-01-01"]) {
    assert.equal(isValidDateStr(ok), true, ok);
  }
  for (const bad of [
    "2026-02-29", "2026-02-30", "2026-13-01", "2026-00-10", "2026-11-31",
    "2026-1-05", "26-11-23", "2026/11/23", "2026-11-23T00:00", " 2026-11-23",
    "2026-11-23 ", "", "abcd-ef-gh", 20261123, null, undefined, "1969-12-31",
  ]) {
    assert.equal(isValidDateStr(bad), false, String(bad));
  }
});

test("addDays and daysBetween cross month/year boundaries", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-11-17", "2026-11-23"), 6);
  assert.equal(daysBetween("2026-11-23", "2026-11-17"), -6);
});

test("check window: up to 1 day ahead of server UTC date, 60 days behind", () => {
  // 01:30 UTC on the 24th is still the evening of the 23rd in US Eastern.
  const now = new Date("2026-11-24T01:30:00Z");
  assert.equal(isDateInCheckWindow("2026-11-23", now), true);
  assert.equal(isDateInCheckWindow("2026-11-24", now), true);
  assert.equal(isDateInCheckWindow("2026-11-25", now), true);
  assert.equal(isDateInCheckWindow("2026-11-26", now), false);
  assert.equal(isDateInCheckWindow("2026-09-25", now), true); // 60 days back
  assert.equal(isDateInCheckWindow("2026-09-24", now), false); // 61 days back
});

test("lastNLocalDates returns n local days ending today, oldest first", () => {
  const today = new Date(2026, 0, 3, 23, 59); // local Jan 3
  assert.deepEqual(lastNLocalDates(today, 7), [
    "2025-12-28", "2025-12-29", "2025-12-30", "2025-12-31",
    "2026-01-01", "2026-01-02", "2026-01-03",
  ]);
  assert.equal(localDateStr(new Date(2026, 10, 23, 0, 0)), "2026-11-23");
});
