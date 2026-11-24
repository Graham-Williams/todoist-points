// Due-date ordering for the Upcoming list, in a US timezone (the user's), so
// local-day handling is exercised against a UTC-offset clock.
process.env.TZ = "America/New_York";

import { test } from "node:test";
import assert from "node:assert/strict";
import { dueSortKey, sortByDue } from "./dueOrder.ts";

const t = (id: string, due: { date: string; datetime?: string | null } | null, content = id) => ({
  id,
  content,
  due,
});
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

test("earliest due first; overdue leads; no due date goes last", () => {
  const out = sortByDue([
    t("none", null),
    t("dec1", { date: "2026-12-01" }),
    t("overdue", { date: "2026-11-20" }),
    t("nov25", { date: "2026-11-25" }),
  ]);
  assert.deepEqual(ids(out), ["overdue", "nov25", "dec1", "none"]);
});

test("within a day: timed tasks by time, then all-day tasks", () => {
  const out = sortByDue([
    t("allday", { date: "2026-11-25" }),
    t("pm", { date: "2026-11-25T15:00:00" }),
    t("am", { date: "2026-11-25T09:30:00" }),
    t("nextday-early", { date: "2026-11-26T00:05:00" }),
  ]);
  assert.deepEqual(ids(out), ["am", "pm", "allday", "nextday-early"]);
});

test("a fixed-zone time is placed on the user's LOCAL day, not the UTC day", () => {
  // 02:00Z on Nov 26 is 9pm on Nov 25 in New York: it belongs to Nov 25,
  // before Nov 25's all-day task and before anything on Nov 26.
  const out = sortByDue([
    t("nov26-allday", { date: "2026-11-26" }),
    t("nov25-allday", { date: "2026-11-25" }),
    t("nov25-9pm", { date: "2026-11-26T02:00:00Z" }),
  ]);
  assert.deepEqual(ids(out), ["nov25-9pm", "nov25-allday", "nov26-allday"]);
});

test("datetime is preferred over date when both are present", () => {
  const out = sortByDue([
    t("late", { date: "2026-11-25", datetime: "2026-11-25T18:00:00" }),
    t("early", { date: "2026-11-25", datetime: "2026-11-25T08:00:00" }),
  ]);
  assert.deepEqual(ids(out), ["early", "late"]);
});

test("ties break on content then id, so the order is stable", () => {
  const out = sortByDue([
    t("2", { date: "2026-11-25" }, "Same"),
    t("x", { date: "2026-11-25" }, "Beta"),
    t("1", { date: "2026-11-25" }, "Same"),
    t("y", { date: "2026-11-25" }, "Alpha"),
  ]);
  assert.deepEqual(ids(out), ["y", "x", "1", "2"]);
});

test("an unparseable due sorts with the undated tasks; the input isn't mutated", () => {
  const input = [t("bad", { date: "soon" }), t("ok", { date: "2026-11-25" })];
  const out = sortByDue(input);
  assert.deepEqual(ids(out), ["ok", "bad"]);
  assert.deepEqual(ids(input), ["bad", "ok"]);
  assert.deepEqual(dueSortKey(null), [Infinity, 2]);
});
