// v1.6.9: same-RO same-tech jobs merge into one block; search-to-add any synced RO.
import assert from "node:assert/strict";
import test from "node:test";
import { schedule, workBetween } from "../app/tech-board/scheduler.ts";
import { normalizeJobs } from "../app/tech-board/ro-jobs.ts";
import { searchRos } from "../app/tech-board/ro-search.ts";
import { botToBoardAction } from "../app/lib/bot-auth.ts";

const techs = [["MC", "Mike Cook"], ["SW", "Stacy Williams"], ["BC", "Beau Corley"], ["AN", "Andrew Nelson"]].map(([initials, name], i) => ({ initials, name, active: true, sortOrder: i, dailyHours: 8 }));
const roster = techs.map(({ initials, name }) => ({ initials, name }));
const opts = { today: "2026-11-03", now: "2026-11-03T14:00:00.000Z", approvedOnly: true, keepToday: true, startDate: "2026-11-03" };
const ro = (roNumber, jobs) => ({ roNumber, label: "Work Not Started", section: "work-in-progress", vehicle: "Car", customer: "C", assignedInitials: [], ageDays: 30, soldHours: 2,
  jobs: normalizeJobs(jobs.map(([jobId, hours, tech, name]) => ({ jobId, name: name ?? `Job ${jobId}`, technician: tech, hours, authorized: true })), roster) });
const appt = (id, roNum, tech, start, end) => ({ id, ro: roNum, tech, date: "2026-11-03", startMinute: start, endMinute: end, key: `${id}|u|${start}|${end}|${tech}` });

test("jobs on one RO for the same tech are one block: hours summed, names listed", () => {
  const board = schedule([ro("38528", [["1", 0.25, "Andrew Nelson", "Oil"], ["2", 0.5, "Andrew Nelson", "Brakes"], ["3", 0.25, "Andrew Nelson", "Wipers"]])], [], techs, opts);
  const blocks = board.filter((job) => job.roNumber === "38528" && !job.hidden);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].ro, "38528-J1", "keeps the first job's key");
  assert.equal(blocks[0].durationMinutes, 60);
  assert.equal(blocks[0].jobName, "Oil + Brakes + Wipers");
  assert.equal(blocks[0].tech, "AN");
});

test("different techs on one RO stay separate and never overlap", () => {
  const board = schedule([ro("38600", [["1", 1, "Mike Cook"], ["2", 1, "Stacy Williams"], ["3", 1, "Mike Cook"]])], [], techs, opts);
  const blocks = board.filter((job) => job.roNumber === "38600");
  assert.equal(blocks.length, 2);
  const mc = blocks.find((job) => job.tech === "MC"), sw = blocks.find((job) => job.tech === "SW");
  assert.equal(mc.durationMinutes, 120); assert.equal(sw.durationMinutes, 60);
  assert.ok(mc.laneDate !== sw.laneDate || mc.startMinute + 120 <= sw.startMinute || sw.startMinute + 60 <= mc.startMinute, "same car never overlaps");
});

test("appointment: merged block starts at the appointment and fills its length", () => {
  const board = schedule([ro("38468", [["1", 0.5, "Andrew Nelson"], ["2", 0.5, "Andrew Nelson"]])], [], techs, { ...opts, tekSchedule: [appt("a", "38468", "AN", 0, 60)], firstSeen: { "38468": "2026-07-01" } });
  const blocks = board.filter((job) => job.roNumber === "38468");
  assert.equal(blocks.length, 1); assert.equal(blocks[0].startMinute, 0); assert.equal(blocks[0].durationMinutes, workBetween(0, 60));
});

test("search finds synced ROs by number, customer or vehicle (multi-word)", () => {
  const ros = [{ ro: "38504", customer: "Chris Leak", vehicle: "2014 Ford F-150", hours: 0 }, { ro: "38470", customer: "Ann Lee", vehicle: "Honda Civic" }];
  assert.equal(searchRos(ros, "chris leak")[0].ro, "38504");
  assert.equal(searchRos(ros, "RO#38504")[0].ro, "38504");
  assert.equal(searchRos(ros, "f-150")[0].ro, "38504");
  assert.equal(searchRos(ros, "civic")[0].ro, "38470");
  assert.equal(searchRos(ros, "zzz").length, 0);
});

test("bot add-ro maps to a board add-ro action", () => {
  const mapped = botToBoardAction({ action: "add-ro", ro: "RO#38504", tech: "BC", date: "2026-11-03", startMinute: 120, durationMinutes: 60 });
  assert.equal(mapped.action, "add-ro"); assert.equal(mapped.ro, "38504"); assert.equal(mapped.tech, "BC"); assert.equal(mapped.laneDate, "2026-11-03");
  assert.ok("error" in botToBoardAction({ action: "add-ro" }));
  assert.equal(botToBoardAction({ action: "add-ro", ro: "38504" }).tech, "UN");
});

test("an RO-linked writer block (unapproved RO) survives the start-date cutoff", () => {
  const existing = [{ ro: "C-x", tech: "BC", laneDate: "2026-11-03", position: 0, startMinute: 120, pinned: true, placedBy: "writer", techEstimateHours: null, startedAt: null,
    custom: true, hidden: false, linkedRo: "38504", title: "", durationMinutes: 60, durationOverrideMinutes: 60 }];
  const unapproved = { roNumber: "38504", label: "Waiting", section: "estimates", vehicle: "F-150", customer: "Chris Leak", jobs: [{ jobId: "1", name: "Radiator", hours: 0, order: 1, approved: false }] };
  const board = schedule([unapproved], existing, techs, { ...opts, firstSeen: { "38504": "2026-10-01" } });
  const block = board.find((job) => job.ro === "C-x");
  assert.ok(block && block.custom && block.linkedRo === "38504" && block.tech === "BC" && block.customer === "Chris Leak");
});
