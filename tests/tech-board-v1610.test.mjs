// v1.6.10: block length follows labor hours (minus completed work); appointment sets start/tech only; long blocks continue next day.
import assert from "node:assert/strict";
import test from "node:test";
import { schedule, wallEnd } from "../app/tech-board/scheduler.ts";
import { normalizeJobs } from "../app/tech-board/ro-jobs.ts";

const techs = [["MC", "Mike Cook"], ["AN", "Andrew Nelson"], ["BC", "Beau Corley"]].map(([initials, name], i) => ({ initials, name, active: true, sortOrder: i, dailyHours: 8, dayMinutes: 480 }));
const roster = techs.map(({ initials, name }) => ({ initials, name }));
const opts = { today: "2026-11-03", now: "2026-11-03T14:00:00.000Z", approvedOnly: true, keepToday: true, startDate: "2026-11-03", firstSeen: { "38528": "2026-10-20" } };
// RO 38528 (Landon Rayner) as synced: BC diag done 0.5h; AN 2.4 + 7.56 + 6.16 = 16.12h open.
const rayner = () => ({ roNumber: "38528", label: "Part Arrived", section: "work-in-progress", vehicle: "2018 Chevrolet Silverado 1500", customer: "Landon Rayner", assignedInitials: [], ageDays: 5, soldHours: 16.62,
  jobs: normalizeJobs([["1", "Diagnose Fluid Leak", "Beau Corley", 0.5, true], ["2", "Transmission Oil Pan Gasket", "Andrew Nelson", 2.4, false],
    ["3", "Engine Oil Pan Gasket", "Andrew Nelson", 7.56, false], ["4", "Exhaust Manifold Gasket", "Andrew Nelson", 6.16, false]]
    .map(([jobId, name, technician, hours, completed]) => ({ jobId, name, technician, hours, completed, authorized: true })), roster) });
const appt = { id: "a", ro: "38528", tech: "AN", date: "2026-11-03", startMinute: 300, endMinute: 360, key: "a|u|300|360|AN" };
const blocksOf = (board) => board.filter((job) => job.roNumber === "38528" && !job.hidden && job.status !== "front-office").sort((a, b) => a.laneDate.localeCompare(b.laneDate) || a.startMinute - b.startMinute);

test("38528: appointment sets start/tech; length = 16.12h of AN's open labor, continued onto next days at 8 AM", () => {
  const blocks = blocksOf(schedule([rayner()], [], techs, { ...opts, tekSchedule: [appt] }));
  assert.ok(blocks.every((job) => job.tech === "AN"));
  assert.equal(blocks[0].ro, "38528-J2"); assert.equal(blocks[0].startMinute, 300); assert.equal(blocks[0].laneDate, "2026-11-03");
  assert.equal(blocks[0].jobName, "Transmission Oil Pan Gasket + Engine Oil Pan Gasket + Exhaust Manifold Gasket");
  assert.equal(blocks.reduce((sum, job) => sum + job.durationMinutes, 0), Math.round(16.12 * 60), "967 min total");
  assert.equal(blocks[0].durationMinutes, 240, "1–5 PM today");
  assert.deepEqual(blocks.slice(1).map((job) => [job.ro, job.laneDate, job.startMinute, job.durationMinutes]),
    [["38528-J2~2", "2026-11-04", 0, 480], ["38528-J2~3", "2026-11-05", 0, 247]]);
  for (const job of blocks) assert.ok(wallEnd(job.startMinute, job.durationMinutes) <= 540, "never past 5 PM");
});

test("percent complete on the board reduces the length; completed Tekmetric jobs are excluded", () => {
  const blocks = blocksOf(schedule([rayner()], [], techs, { ...opts, tekSchedule: [appt], progress: { "38528-J2": { percent: 50, done: false } } }));
  assert.equal(blocks.reduce((sum, job) => sum + job.durationMinutes, 0), 480, "16.12h × 50% → 480 min (15-min snap)");
  const order = rayner(); order.jobs[1].completed = true; order.jobs[2].completed = true;
  const only = blocksOf(schedule([order], [], techs, { ...opts, tekSchedule: [appt] }));
  assert.equal(only[0].ro, "38528"); assert.equal(only[0].jobName, "Exhaust Manifold Gasket"); assert.equal(only[0].durationMinutes, 240);
  assert.deepEqual(only.slice(1).map((job) => [job.laneDate, job.startMinute, job.durationMinutes]), [["2026-11-04", 0, 130]]);
  assert.equal(blocksOf(schedule([order], [], techs, { ...opts, tekSchedule: [appt] })).reduce((s, j) => s + j.durationMinutes, 0), Math.round(6.16 * 60));
});

test("continuation segments skip busy time on the next day (no overlap)", () => {
  const timeOff = [{ id: 1, initials: "AN", date: "2026-11-04", startMinute: 0, endMinute: 120, allDay: false, reason: "Doctor" }];
  const blocks = blocksOf(schedule([rayner()], [], techs, { ...opts, tekSchedule: [appt], timeOff }));
  const next = blocks.filter((job) => job.laneDate === "2026-11-04");
  assert.ok(next.length >= 1 && next[0].startMinute >= 120, "starts after the 8–10 time off");
  assert.equal(blocks.reduce((sum, job) => sum + job.durationMinutes, 0), 967);
});
