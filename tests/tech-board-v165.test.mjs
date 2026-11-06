// v1.6.5/v1.6.6: a finished diag leaves the 8–5 grid for the 6–7 AM Front office row (no work time).
import assert from "node:assert/strict";
import test from "node:test";
import { schedule } from "../app/tech-board/scheduler.ts";
import { normalizeJobs } from "../app/tech-board/ro-jobs.ts";

const techs = [{ initials: "SW", name: "Stacy Williams", active: true, sortOrder: 1, dailyHours: 8 }];
const roster = techs.map(({ initials, name }) => ({ initials, name }));
const opts = { today: "2026-11-03", now: "2026-11-03T14:00:00.000Z", approvedOnly: true };
const ro = (roNumber, jobs) => ({ roNumber, label: "Needs Diag.", section: "work-in-progress", vehicle: "Car", customer: "C", assignedInitials: ["SW"], ageDays: 1, soldHours: 2,
  jobs: normalizeJobs(jobs, roster) });

test("Diag Done update moves the diag block into the strip and frees its 8–10 time", () => {
  const orders = [ro("100", [{ jobId: "1", name: "Diagnostic Test", technician: "Stacy Williams", hours: 1, authorized: true }]),
    ro("101", [{ jobId: "1", name: "Diagnostic Test", technician: "Stacy Williams", hours: 1, authorized: true }])];
  const before = schedule(orders, [], techs, opts);
  const old100 = before.find((job) => job.roNumber === "100");
  const after = schedule(orders, before, techs, { ...opts, progress: { [old100.ro]: { percent: null, done: true } } });
  const done = after.find((job) => job.ro === old100.ro);
  assert.equal(done.status, "front-office");
  assert.equal(done.tech, "SW");
  assert.equal(done.inDiagBlock, false);
  assert.equal(done.startMinute, -120, "6 AM slot");
  const grid = after.filter((job) => job.status !== "front-office" && job.tech === "SW");
  assert.equal(grid.length, 1);
  assert.equal(grid[0].startMinute, 0, "the other diag takes the freed 8 AM slot");
  // Rebuilding again keeps it in the strip, never back on the grid.
  const again = schedule(orders, after, techs, { ...opts, progress: { [old100.ro]: { percent: null, done: true } } });
  assert.equal(again.find((job) => job.ro === old100.ro).status, "front-office");
});

test("Tekmetric completed diag job shows in the strip; its repair job stays on the grid", () => {
  const orders = [ro("200", [{ jobId: "1", name: "Diagnostic Test", technician: "Stacy Williams", hours: 1, authorized: true, completed: true },
    { jobId: "2", name: "Brake Pads", technician: "Stacy Williams", hours: 2, authorized: true }])];
  const board = schedule(orders, [], techs, opts);
  const done = board.filter((job) => job.status === "front-office");
  assert.equal(done.length, 1);
  assert.equal(done[0].jobName, "Diagnostic Test");
  const repair = board.find((job) => job.jobName === "Brake Pads");
  assert.equal(repair.status, "ready");
  assert.equal(repair.tech, "SW");
});

test("v1.6.6: Front office carries to the next shop day until the ticket is fully done; writers can drag in and out", () => {
  const orders = [ro("300", [{ jobId: "1", name: "Diagnostic Test", technician: "Stacy Williams", hours: 1, authorized: true, completed: true },
    { jobId: "2", name: "Brake Pads", technician: "Stacy Williams", hours: 2, authorized: true }])];
  const day1 = schedule(orders, [], techs, opts);
  const front = day1.find((job) => job.status === "front-office");
  // Next shop day (Wed): still in the row, dated today.
  const day2 = schedule(orders, day1, techs, { ...opts, today: "2026-11-04", now: "2026-11-04T14:00:00.000Z" });
  const again = day2.find((job) => job.ro === front.ro);
  assert.equal(again.status, "front-office"); assert.equal(again.laneDate, "2026-11-04");
  // Fully done (all approved jobs completed) → gone.
  const doneOrders = [ro("300", [{ jobId: "1", name: "Diagnostic Test", technician: "Stacy Williams", hours: 1, authorized: true, completed: true },
    { jobId: "2", name: "Brake Pads", technician: "Stacy Williams", hours: 2, authorized: true, completed: true }])];
  assert.equal(schedule(doneOrders, day2, techs, opts).length, 0);
  // Writer drags the repair job into the row (start -120, pinned) → stays there, no grid time.
  const repair = day1.find((job) => job.jobName === "Brake Pads");
  const moved = day1.map((job) => job.ro === repair.ro ? { ...job, startMinute: -120, pinned: true, placedBy: "writer", status: "front-office" } : job);
  const b = schedule(orders, moved, techs, opts);
  assert.equal(b.find((job) => job.ro === repair.ro).status, "front-office");
  // Writer drags the finished diag out onto the grid → it stays on the grid.
  const out = b.map((job) => job.ro === front.ro ? { ...job, startMinute: 300, pinned: true, placedBy: "writer", status: "ready" } : job);
  const c = schedule(orders, out, techs, opts).find((job) => job.ro === front.ro);
  assert.notEqual(c.status, "front-office"); assert.ok(c.startMinute >= 0);
});
