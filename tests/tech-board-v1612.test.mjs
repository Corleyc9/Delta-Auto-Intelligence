// v1.6.12: no-RO appointments as customer blocks, yellow appointments locked, RO-linked blocks carry forward, tech ticket controls.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { schedule, toTekSchedule, isLockedJob } from "../app/tech-board/scheduler.ts";

const techs = [["MB", "Mario Butler"], ["SW", "Stacy Williams"]].map(([initials, name], i) => ({ initials, name, active: true, sortOrder: i, dailyHours: 8, dayMinutes: 480 }));
const opts = { today: "2026-11-04", now: "2026-11-04T13:00:00.000Z", keepToday: true };
const rows = [
  { id: "1", roNumber: "", employeeId: "9", employeeName: "Mario Butler", start: "2026-11-04T14:00:00Z", end: "2026-11-04T14:45:00Z", updated: "u", color: "#FCB70D", customer: "Tim Lindsay", title: "" },
  { id: "2", roNumber: "38512", employeeId: "9", employeeName: "Mario Butler", start: "2026-11-04T17:00:00Z", end: "2026-11-04T18:00:00Z", updated: "u", color: "#FCB70D", customer: "Michael Thornton", title: "" },
];
const ro = { roNumber: "38512", label: "Part Arrived", section: "work-in-progress", vehicle: "Car", customer: "MICHAEL THORNTON", assignedInitials: ["MB"], ageDays: 1, soldHours: 1 };

test("reader color reaches the board; yellow = locked key; no-RO appointment kept", () => {
  const tek = toTekSchedule(rows, techs);
  assert.equal(tek.length, 2); assert.ok(tek.every((item) => item.yellow && item.key.startsWith("Y|")));
});

test("no-RO yellow appointment becomes a locked customer block at the exact time", () => {
  const board = schedule([ro], [], techs, { ...opts, tekSchedule: toTekSchedule(rows, techs) });
  const tim = board.find((job) => job.ro === "APPT-1");
  assert.equal(tim.tech, "MB"); assert.equal(tim.startMinute, 0); assert.equal(tim.durationMinutes, 45);
  assert.match(tim.title, /Tim Lindsay/); assert.ok(isLockedJob(tim));
  const thornton = board.find((job) => job.roNumber === "38512" && !job.hidden);
  assert.equal(thornton.startMinute, 180); assert.ok(isLockedJob(thornton)); assert.equal(thornton.status, "preset");
});

test("v1.6.13: a writer drag of a yellow appointment sticks; a hand-made block for the same customer is not duplicated", () => {
  const tek = toTekSchedule(rows, techs);
  const existing = [{ ro: "38512", roNumber: "38512", tech: "SW", laneDate: "2026-11-04", position: 0, startMinute: 300, pinned: true, placedBy: "writer", apptKey: tek[1].key, status: "preset" },
    { ro: "C-x", tech: "MB", laneDate: "2026-11-04", position: 0, startMinute: 0, pinned: true, placedBy: "writer", custom: true, title: "PRE-SET · Tim Lindsay · oil change", durationMinutes: 45 }];
  const board = schedule([ro], existing, techs, { ...opts, tekSchedule: tek });
  const t = board.find((job) => job.roNumber === "38512" && !job.hidden);
  assert.equal(t.tech, "SW"); assert.equal(t.startMinute, 300); assert.ok(isLockedJob(t), "keeps the lock tag");
  assert.equal(board.filter((job) => job.ro === "APPT-1").length, 0);
});

test("RO-linked block left on yesterday carries to today while the RO is open", () => {
  const board = schedule([ro], [{ ro: "C-y", tech: "SW", laneDate: "2026-11-03", position: 0, startMinute: 120, pinned: true, placedBy: "writer", custom: true, linkedRo: "38512", title: "Follow up", durationMinutes: 60 }], techs, opts);
  const block = board.find((job) => job.ro === "C-y");
  assert.equal(block.laneDate, "2026-11-04"); assert.equal(block.startMinute, 120); assert.equal(block.carriedOver, true);
});

test("tech page has the writer ticket controls (status, %, estimate, comment, save) and no writer tools", () => {
  const src = readFileSync(new URL("../app/tech-board/TechPage.tsx", import.meta.url), "utf8");
  for (const needle of ["function TechTicket", "% complete", "My estimate (h)", "Comment<textarea", "ISSUES.map", "SuggestionBox", "Open in Tekmetric"]) assert.ok(src.includes(needle), needle);
  for (const banned of ["remove-mirror-blocks", "pin-set", "add-custom", "\"move\"", "\"resize\"", "add-ro"]) assert.ok(!src.includes(banned), banned);
  const route = readFileSync(new URL("../app/api/tech/route.ts", import.meta.url), "utf8");
  assert.ok(route.includes("AND tech = ?"), "estimate only on the tech's own job");
});
