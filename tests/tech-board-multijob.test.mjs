// v1.3: one block per Tekmetric job; same-RO blocks (same car) never overlap across techs.
import assert from "node:assert/strict";
import test from "node:test";
import { schedule, snapSameRo, resizePush, wallEnd, expandJobs, DIAG_END } from "../app/tech-board/scheduler.ts";
import { normalizeJobs, jobsFromPayload } from "../app/tech-board/ro-jobs.ts";

const today = "2026-11-02";
const techs = [{ initials: "MC", name: "Mike Cook" }, { initials: "AN", name: "Andrew Nelson" }, { initials: "BC", name: "Beau Corley" }];
const multi = (extra = {}) => ({ roNumber: "18402", label: "In-Progress", section: "work-in-progress", vehicle: "2012 Chevy Tahoe", customer: "Ron Avery",
  assignedInitials: ["MC", "AN"], ageDays: 3, soldHours: 5,
  jobs: [{ jobId: "1", name: "Brakes", techInitials: "MC", hours: 2, order: 1 }, { jobId: "2", name: "Alignment", techInitials: "AN", hours: 1.5, order: 2 }], ...extra });
const overlap = (a, b) => a.laneDate === b.laneDate && a.startMinute < wallEnd(b.startMinute, b.durationMinutes) && b.startMinute < wallEnd(a.startMinute, a.durationMinutes);

test("job-level tech + hours come from synced jobs (reader or Tekmetric webhook payload)", () => {
  const payload = { data: { repairOrderNumber: 18402, jobs: [
    { id: 11, name: "Brakes", technician: { firstName: "Mike", lastName: "Cook" }, laborHours: 2, sort: 1 },
    { id: 12, name: "Alignment", technicianId: 7, labor: [{ hours: 1, technicianId: 7 }, { hours: 0.5 }], sort: 2 },
    { id: 13, name: "Wipers", authorized: false, laborHours: 0.2 }] } };
  const jobs = normalizeJobs(jobsFromPayload(payload), techs, { 7: "Andrew Nelson" });
  assert.deepEqual(jobs.map((job) => [job.jobId, job.name, job.techInitials, job.hours, job.order]), [["11", "Brakes", "MC", 2, 1], ["12", "Alignment", "AN", 1.5, 2]]);
  assert.deepEqual(expandJobs([multi()]).map((unit) => [unit.roNumber, unit.parentRo, unit.assignedInitials[0], unit.soldHours]),
    [["18402-J1", "18402", "MC", 2], ["18402-J2", "18402", "AN", 1.5]]);
});

test("same-RO jobs on different techs are serialized, in Tekmetric job order; the tech fills the gap", () => {
  const filler = { roNumber: "18500", label: "In-Progress", section: "work-in-progress", vehicle: "Car", customer: "Kim Dale", assignedInitials: ["AN"], ageDays: 1, soldHours: 1 };
  const jobs = schedule([multi(), filler], [], undefined, { today });
  const brakes = jobs.find((job) => job.ro === "18402-J1"), align = jobs.find((job) => job.ro === "18402-J2");
  assert.equal(brakes.tech, "MC"); assert.equal(align.tech, "AN");
  assert.equal(brakes.roNumber, "18402"); assert.equal(align.jobName, "Alignment");
  assert.equal(brakes.startMinute, DIAG_END);
  assert.ok(align.startMinute >= wallEnd(brakes.startMinute, brakes.durationMinutes)); // after Brakes ends
  assert.ok(!overlap(brakes, align));
  assert.equal(jobs.find((job) => job.ro === "18500").startMinute, DIAG_END); // AN works the other car meanwhile
});

test("no overlap holds for diag, Pre-Set and writer-preferred placements", () => {
  const diagRo = multi({ label: "Needs Diag.", jobs: [{ jobId: "1", name: "Diag A", techInitials: "MC", hours: 1, order: 1 }, { jobId: "2", name: "Diag B", techInitials: "AN", hours: 1, order: 2 }] });
  const d = schedule([diagRo], [], undefined, { today });
  assert.ok(!overlap(d[0], d[1])); for (const job of d) assert.ok(job.startMinute + job.durationMinutes <= DIAG_END || job.laneDate !== today);
  // A writer preference that would overlap the sibling reflows instead.
  const existing = [{ ro: "18402-J2", tech: "AN", laneDate: today, position: 0, startMinute: 150, pinned: true, placedBy: "writer", techEstimateHours: null, startedAt: null }];
  const p = schedule([multi()], existing, undefined, { today });
  assert.ok(!overlap(p.find((job) => job.ro === "18402-J1"), p.find((job) => job.ro === "18402-J2")));
  // Pre-Set appointment time for an RO is not stacked on its own other job.
  const appointments = [{ date: today, employee: "Andrew Nelson", startMinute: 120, endMinute: 240, text: "RO#18402 Pre-Set Apt", color: "#fcb70d" }];
  const pre = schedule([multi({ label: "Pre-Set Apt" })], [], undefined, { today, appointments });
  assert.ok(!overlap(pre[0], pre[1]));
});

test("drag into an overlap snaps after the conflicting job; resize pushes the later job", () => {
  const blocks = [
    { key: "18402-J1", ro: "18402", laneDate: today, startMinute: 120, durationMinutes: 120, tech: "MC" },
    { key: "18402-J2", ro: "18402", laneDate: today, startMinute: 300, durationMinutes: 90, tech: "AN" },
    { key: "18500", ro: "18500", laneDate: today, startMinute: 120, durationMinutes: 60, tech: "AN" },
  ];
  assert.deepEqual(snapSameRo(blocks, "18402-J2", "18402", today, 150, 90), { start: 300, conflictWith: "18402-J1" }); // 10–12 busy -> after lunch
  assert.deepEqual(snapSameRo(blocks, "18402-J2", "18402", today, 400, 60), { start: 400, conflictWith: null });
  assert.equal(snapSameRo(blocks, "18402-J2", "18402", "2026-11-03", 120, 90).conflictWith, null); // other day is fine
  assert.deepEqual(resizePush(blocks, "18402-J1", 240), { key: "18402-J2", start: wallEnd(120, 240) });
  assert.equal(resizePush(blocks, "18402-J1", 60), null);
});

test("carry-over with multiple jobs: each job carries its own remaining time and they still don't overlap", () => {
  const existing = [
    { ro: "18402-J1", tech: "MC", laneDate: "2026-10-30", position: 0, startMinute: 120, pinned: false, placedBy: "auto", techEstimateHours: null, startedAt: null },
    { ro: "18402-J2", tech: "AN", laneDate: "2026-10-30", position: 0, startMinute: 300, pinned: false, placedBy: "auto", techEstimateHours: null, startedAt: null },
  ];
  const progress = { "18402-J1": { percent: 50, done: false }, "18402-J2": { percent: 0, done: false } };
  const jobs = schedule([multi()], existing, undefined, { today, progress });
  const a = jobs.find((job) => job.ro === "18402-J1"), b = jobs.find((job) => job.ro === "18402-J2");
  assert.equal(a.carriedOver, true); assert.equal(b.carriedOver, true);
  assert.equal(a.tech, "MC"); assert.equal(b.tech, "AN"); assert.equal(a.laneDate, today);
  assert.equal(a.durationMinutes, 60); assert.equal(b.durationMinutes, 90); // 2h x 50%, 1.5h x 100%
  assert.ok(!overlap(a, b));
  // A finished job drops; its sibling stays.
  const done = schedule([multi()], existing, undefined, { today, progress: { "18402-J1": { percent: 100, done: true } } });
  assert.deepEqual(done.map((job) => job.ro), ["18402-J2"]);
});

test("a writer-moved job does not drag its earlier siblings later; later siblings still follow", () => {
  const three = multi({ jobs: [{ jobId: "1", name: "Brakes", techInitials: "MC", hours: 2, order: 1 }, { jobId: "2", name: "Alignment", techInitials: "AN", hours: 1.5, order: 2 }, { jobId: "3", name: "Shocks", techInitials: "BC", hours: 1, order: 3 }] });
  const existing = [{ ro: "18402-J2", tech: "AN", laneDate: today, position: 0, startMinute: 300, pinned: true, placedBy: "writer", techEstimateHours: null, startedAt: null }];
  const jobs = schedule([three], existing, undefined, { today });
  const [a, b, c] = ["18402-J1", "18402-J2", "18402-J3"].map((key) => jobs.find((job) => job.ro === key));
  assert.equal(a.startMinute, DIAG_END); assert.equal(b.startMinute, 300);
  assert.ok(c.startMinute >= wallEnd(b.startMinute, b.durationMinutes));
  for (const [x, y] of [[a, b], [a, c], [b, c]]) assert.ok(!overlap(x, y));
});
