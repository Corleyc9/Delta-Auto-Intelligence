// v1.6.8: the Tech Board mirrors Tekmetric's schedule (Appointments → Day - Employee).
import assert from "node:assert/strict";
import test from "node:test";
import { schedule, workBetween } from "../app/tech-board/scheduler.ts";
import { normalizeJobs } from "../app/tech-board/ro-jobs.ts";
import { botToBoardAction } from "../app/lib/bot-auth.ts";

const techs = [["MC", "Mike Cook"], ["SW", "Stacy Williams"], ["BC", "Beau Corley"]].map(([initials, name], i) => ({ initials, name, active: true, sortOrder: i, dailyHours: 8 }));
const roster = techs.map(({ initials, name }) => ({ initials, name }));
const opts = { today: "2026-11-03", now: "2026-11-03T14:00:00.000Z", approvedOnly: true, keepToday: true, startDate: "2026-11-03" };
const ro = (roNumber, jobs, tech = "Stacy Williams") => ({ roNumber, label: "Work Not Started", section: "work-in-progress", vehicle: "Car", customer: "C", assignedInitials: [], ageDays: 30, soldHours: 2,
  jobs: normalizeJobs(jobs.map(([jobId, hours]) => ({ jobId, name: `Job ${jobId}`, technician: tech, hours, authorized: true })), roster) });
const appt = (id, roNum, tech, start, end, date = "2026-11-03") => ({ id, ro: roNum, tech, date, startMinute: start, endMinute: end, key: `${id}|u|${start}|${end}|${tech}` });

test("appointments place the RO's approved jobs at Tekmetric's tech/start, stacked to its end; early rows; Unassigned → pool", () => {
  const orders = [ro("38314", [["1", 1], ["2", 1.5]]), ro("38482", [["1", 1]]), ro("38530", [["1", 2]]), ro("38504", [["1", 3]])];
  const tek = [appt("a", "38314", "BC", 60, 210), appt("b", "38482", "SW", -120, -60), appt("c", "38530", null, -120, -60), appt("d", "38504", "BC", 210, 570)];
  const board = schedule(orders, [], techs, { ...opts, tekSchedule: tek, firstSeen: { "38314": "2026-07-01", "38482": "2026-07-01", "38530": "2026-07-01", "38504": "2026-07-01" } });
  const j = (key) => board.find((job) => job.ro === key);
  assert.equal(j("38314-J1").tech, "BC"); assert.equal(j("38314-J1").startMinute, 60);
  // v1.6.9: both jobs are Stacy's on the RO → one merged block filling the appointment.
  assert.equal(j("38314-J2"), undefined, "merged into one block");
  assert.equal(j("38314-J1").durationMinutes, 150, "v1.6.10: 1h + 1.5h of labor");
  assert.equal(j("38482").startMinute, -120); assert.equal(j("38482").tech, "SW");
  assert.equal(j("38530").tech, "UN");
  assert.equal(j("38504").durationMinutes, 180, "v1.6.10: 3h of labor from 11:30, not the appointment length");
  assert.equal(workBetween(210, 570), 300);
});

test("hidden jobs with an appointment come back; Tekmetric changes override a writer drag, unchanged appointment keeps it", () => {
  const orders = [ro("38575", [["1", 1]])];
  const tek = [appt("e", "38575", "SW", 0, 60)];
  const hidden = [{ ro: "38575", roNumber: "38575", tech: "UN", laneDate: "2026-11-03", position: 0, startMinute: 0, pinned: false, placedBy: "writer", techEstimateHours: null, startedAt: null, hidden: true }];
  const shown = schedule(orders, hidden, techs, { ...opts, tekSchedule: tek });
  assert.equal(shown[0].hidden, false); assert.equal(shown[0].tech, "SW");
  const dragged = [{ ...shown[0], tech: "MC", startMinute: 300, pinned: true, placedBy: "writer" }];
  assert.equal(schedule(orders, dragged, techs, { ...opts, tekSchedule: tek })[0].tech, "MC", "writer drag kept while appointment unchanged");
  const moved = [appt("e", "38575", "SW", 120, 180)]; moved[0].key = "e|u2|120|180|SW";
  const again = schedule(orders, dragged, techs, { ...opts, tekSchedule: moved })[0];
  assert.deepEqual([again.tech, again.startMinute], ["SW", 120], "Tekmetric change re-applied");
});

test("bot remove-mirror-blocks maps through", () => {
  assert.deepEqual(botToBoardAction({ action: "remove-mirror-blocks" }), { action: "remove-mirror-blocks" });
});

test("Chicago minutes from 8 AM and tech mapping from Tekmetric employee names", async () => {
  const { chicagoMinute, toTekSchedule } = await import("../app/tech-board/scheduler.ts");
  assert.equal(chicagoMinute("2026-11-03T12:00:00Z"), -120);
  const [a] = toTekSchedule([{ id: "1", roNumber: "37513", employeeId: "72853", employeeName: "MIKE COOK", start: "2026-11-03T13:00:00Z", end: "2026-11-03T13:30:00Z", updated: "u" }], roster);
  assert.deepEqual([a.tech, a.date, a.startMinute, a.endMinute], ["MC", "2026-11-03", -60, -30]);
});
