// v1.6.2: only approved Tekmetric jobs are scheduled or pooled; Needs Diag repair jobs are not diag blocks.
import assert from "node:assert/strict";
import test from "node:test";
import { schedule, expandJobs, DIAG_END } from "../app/tech-board/scheduler.ts";
import { normalizeJobs } from "../app/tech-board/ro-jobs.ts";

const techs = [{ initials: "SW", name: "Stacy Williams", active: true, sortOrder: 1, dailyHours: 8 }, { initials: "MC", name: "Mike Cook", active: true, sortOrder: 2, dailyHours: 8 }];
const roster = techs.map(({ initials, name }) => ({ initials, name }));
const opts = { today: "2026-11-03", now: "2026-11-03T14:00:00.000Z", approvedOnly: true };
const ro = (roNumber, label, jobs, extra = {}) => ({ roNumber, label, section: "work-in-progress", vehicle: "Car", customer: "C", assignedInitials: ["SW"], ageDays: 1, soldHours: 3,
  jobs: normalizeJobs(jobs, roster), ...extra });

test("unapproved / declined / pending / no-job-detail ROs are left off the schedule and the pool", () => {
  const orders = [
    ro("1", "Work Not Started", [{ jobId: "1", name: "Brakes", technician: "Stacy Williams", hours: 2, authorized: true }]),
    ro("2", "Work Not Started", [{ jobId: "1", name: "Struts", technician: null, hours: 3, authorized: null }]),           // pending estimate
    ro("3", "Part Arrived", [{ jobId: "1", name: "Pump", technician: null, hours: 1, authorized: false }]),               // declined
    ro("4", "Pre-Set", [], { section: "estimates" }),                                                                     // no approved job
    { roNumber: "5", label: "Needs Diag.", section: "estimates", vehicle: "Car", customer: "C", assignedInitials: [], soldHours: 1 }, // no job detail
    ro("6", "Work Not Started", [{ jobId: "1", name: "Tires", technician: null, hours: 1, authorized: true }]),           // approved, unassigned
  ];
  const board = schedule(orders, [], techs, opts);
  assert.deepEqual([...new Set(board.map((job) => job.roNumber))].sort(), ["1", "6"]);
  assert.deepEqual(board.filter((job) => job.tech === "UN").map((job) => job.roNumber), ["6"]);
  // Without approvedOnly (old behaviour) the pending/declined/estimate ROs were pulled in.
  assert.ok(new Set(schedule(orders, [], techs, { ...opts, approvedOnly: false }).map((job) => job.roNumber)).size > 2);
});

test("reader Tech Board jobs (authorized: true) count as approved; the job-board route keeps the flag", () => {
  const [job] = normalizeJobs([{ jobId: "9", name: "Diagnostic Test", technician: null, hours: 1, authorized: true }], roster);
  assert.equal(job.approved, true);
  const [pending] = normalizeJobs([{ jobId: "9", name: "Diagnostic Test", hours: 1 }], roster);
  assert.equal(pending.approved, false);
});

test("Needs Diag: kept only if its diag job is approved; its repair jobs are regular work, not 8–10 diag blocks", () => {
  const noDiag = ro("10", "Needs Diag.", [{ jobId: "1", name: "Remove & Replace Shift Cable", technician: "Stacy Williams", hours: 1.68, authorized: true },
    { jobId: "2", name: "Diagnostic Test", technician: "Stacy Williams", hours: 1, authorized: null }]);
  assert.equal(expandJobs([noDiag], true).length, 0, "diag job not approved → RO left off");
  const withDiag = ro("11", "Needs Diag.", [{ jobId: "1", name: "Diagnostic Test", technician: "Stacy Williams", hours: 1, authorized: true },
    { jobId: "2", name: "Steering Stabilizer (Install)", technician: "Stacy Williams", hours: 1, authorized: true }]);
  const board = schedule([withDiag], [], techs, opts);
  const diag = board.find((job) => job.jobName === "Diagnostic Test");
  const repair = board.find((job) => job.jobName.startsWith("Steering"));
  assert.equal(diag.status, "diag");
  assert.ok(diag.startMinute < DIAG_END);
  assert.equal(repair.status, "ready");
  assert.ok(repair.startMinute >= DIAG_END, "repair job is not put in the 8–10 diag window");
});

test("Needs Diag with its diag already Completed: the approved repair job is scheduled/pooled", () => {
  const order = ro("38570", "Needs Diag.", [{ jobId: "w1", name: "Diagnostic Test", technician: "Stacy Williams", hours: 1, completed: true, authorized: true },
    { jobId: "2", name: "Remove & Replace Automatic Transmission Shift Cable", technician: null, hours: 1.68, authorized: true }]);
  const all = schedule([order], [], techs, opts);
  assert.equal(all.filter((job) => job.status === "front-office").length, 1, "v1.6.5: completed diag sits in the Front office row");
  const board = all.filter((job) => job.status !== "front-office");
  assert.equal(board.length, 1);
  assert.equal(board[0].tech, "UN");
  assert.equal(board[0].status, "ready");
});

test("v1.6.3: pool = Tekmetric Unassigned lane incl. waiting tickets; waiting tickets are never auto-scheduled", () => {
  const orders = [
    ro("38530", "Waiting on Parts", [{ jobId: "1", name: "Window Regulator Motor", technician: null, hours: 2.88, authorized: true }]),
    ro("38362", "Waiting/Cust. or Unit", ["DOT Inspection", "Brake Pads", "Tire", "Filler Neck"].map((name, i) => ({ jobId: String(i + 1), name, technician: null, hours: 1, authorized: true }))),
    ro("38400", "Waiting on Parts", [{ jobId: "1", name: "Pump", technician: "Stacy Williams", hours: 1, authorized: true }]), // assigned waiting: off the board
    ro("38401", "Waiting on Parts", [{ jobId: "1", name: "Hose", technician: null, hours: 1, authorized: null }]),            // unapproved: off
  ];
  const writerDrag = [{ ro: "38530", tech: "SW", laneDate: "2026-11-03", position: 0, startMinute: 120, pinned: true, placedBy: "writer", techEstimateHours: null, startedAt: null }];
  const board = schedule(orders, writerDrag, techs, opts);
  assert.deepEqual(board.map((job) => [job.roNumber, job.tech, job.status]).sort(),
    [["38362", "UN", "waiting"], ["38362", "UN", "waiting"], ["38362", "UN", "waiting"], ["38362", "UN", "waiting"], ["38530", "UN", "waiting"]]);
  assert.equal(board.find((job) => job.roNumber === "38530").label, "Waiting on Parts", "pool card keeps its status label");
});
