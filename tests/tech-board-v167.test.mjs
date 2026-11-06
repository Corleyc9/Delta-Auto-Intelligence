// v1.6.7: board start date cutoff, today's schedule is set, 7–8 AM row, RO-linked custom blocks, dedupe action.
import assert from "node:assert/strict";
import test from "node:test";
import { schedule, boardStart, blockRo, clampStart } from "../app/tech-board/scheduler.ts";
import { normalizeJobs } from "../app/tech-board/ro-jobs.ts";
import { botToBoardAction } from "../app/lib/bot-auth.ts";

const techs = [{ initials: "SW", name: "Stacy Williams", active: true, sortOrder: 1, dailyHours: 8 }, { initials: "MC", name: "Mike Cook", active: true, sortOrder: 2, dailyHours: 8 }];
const roster = techs.map(({ initials, name }) => ({ initials, name }));
const opts = { today: "2026-11-03", now: "2026-11-03T14:00:00.000Z", approvedOnly: true, keepToday: true, startDate: "2026-11-03" };
const ro = (roNumber, hours = 2, tech = "Stacy Williams", label = "Work Not Started") => ({ roNumber, label, section: "work-in-progress", vehicle: "Car", customer: "C",
  assignedInitials: [], ageDays: 1, soldHours: hours, jobs: normalizeJobs([{ jobId: "1", name: "Job", technician: tech, hours, authorized: true }], roster) });

test("RO first seen before the start date is ignored unless already on the board (job row or RO-linked custom block)", () => {
  const firstSeen = { "100": "2026-10-20", "101": "2026-11-03", "102": "2026-10-01", "103": "2026-10-01" };
  const existing = [{ ro: "C-x", tech: "MC", laneDate: "2026-11-03", position: 0, startMinute: 120, pinned: true, placedBy: "writer", techEstimateHours: null, startedAt: null,
    custom: true, title: "RO#102 Smith · brakes", durationMinutes: 60, durationOverrideMinutes: 60 },
    { ro: "103", roNumber: "103", tech: "SW", laneDate: "2026-11-03", position: 0, startMinute: 300, pinned: false, placedBy: "auto", techEstimateHours: null, startedAt: null, durationMinutes: 60 }];
  const board = schedule([ro("100"), ro("101"), ro("102"), ro("103", 1)], existing, techs, { ...opts, firstSeen });
  const ros = new Set(board.filter((job) => !job.custom).map((job) => job.roNumber));
  assert.ok(!ros.has("100"), "old dead ticket not added");
  assert.ok(ros.has("101"), "new ticket added");
  assert.ok(ros.has("102"), "RO linked by a custom block title keeps updating");
  assert.ok(ros.has("103"), "RO already on the board keeps updating");
  assert.equal(board.find((job) => job.custom).label, "Work Not Started", "custom block gets its RO's label");
});

test("today's placed blocks are set: same tech/time/length; new tickets fill open time only", () => {
  const existing = [{ ro: "200", roNumber: "200", tech: "SW", laneDate: "2026-11-03", position: 0, startMinute: 360, pinned: false, placedBy: "auto",
    techEstimateHours: null, startedAt: null, durationMinutes: 90, status: "ready" }];
  const board = schedule([ro("200", 4), ro("201", 2)], existing, techs, { ...opts, firstSeen: {} });
  const kept = board.find((job) => job.ro === "200");
  // v1.6.10: tech/time kept, length follows labor (4h from 2 PM → 3h today, 1h continues next day).
  assert.deepEqual([kept.tech, kept.startMinute, kept.durationMinutes], ["SW", 360, 180]);
  assert.equal(board.find((job) => job.ro === "200~2").durationMinutes, 60);
  const added = board.find((job) => job.ro === "201");
  assert.ok(added.startMinute + added.durationMinutes <= 360 || added.startMinute >= 450 || added.tech !== "SW", "new work doesn't overlap the set block");
});

test("7–8 AM row: starts -120 and -60 are accepted; others snap ≥ 0 off lunch", () => {
  assert.equal(boardStart(-120), -120); assert.equal(boardStart(-60), -60); assert.equal(boardStart(-100), -120);
  assert.equal(boardStart(17), 15); assert.equal(clampStart(-60), -60);
  assert.equal(blockRo({ title: "RO#38470 Lee · diag" }), "38470"); assert.equal(blockRo({ linkedRo: "38512", title: "x" }), "38512");
});

test("bot actions set-start-date and dedupe-front-office map through", () => {
  assert.deepEqual(botToBoardAction({ action: "set-start-date", date: "2026-11-03" }), { action: "set-start-date", date: "2026-11-03" });
  assert.deepEqual(botToBoardAction({ action: "dedupe-front-office" }), { action: "dedupe-front-office" });
  assert.equal(botToBoardAction({ action: "move", ro: "C-1", startMinute: -60 }).startMinute, -60);
});
