import assert from "node:assert/strict";
import test from "node:test";
import { dashboardRanges, reportingWeekKey } from "../app/lib/calendar.ts";

test("reporting week starts on Wednesday in America/Chicago", () => {
  // Tuesday 15 Sep 2026, noon Central (CDT, UTC-5).
  const tuesday = new Date("2026-09-15T17:00:00Z");
  assert.equal(reportingWeekKey(tuesday), "2026-09-09");

  // Wednesday 16 Sep 2026 opens the next reporting week.
  const wednesday = new Date("2026-09-16T17:00:00Z");
  assert.equal(reportingWeekKey(wednesday), "2026-09-16");
});

test("dashboardRanges uses Wednesday–Tuesday bounds", () => {
  const ranges = dashboardRanges();
  const thisStart = new Date(`${ranges.thisWeek.start}T12:00:00Z`);
  const thisEnd = new Date(`${ranges.thisWeek.end}T12:00:00Z`);
  assert.equal(thisStart.getUTCDay(), 3, "this week should start on Wednesday");
  assert.equal(thisEnd.getUTCDay(), 2, "this week should end on Tuesday");
  assert.equal(
    (thisEnd.getTime() - thisStart.getTime()) / 86400000,
    6,
  );
});
