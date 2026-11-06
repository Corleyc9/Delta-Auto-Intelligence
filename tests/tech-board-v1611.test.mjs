// v1.6.11: front-office (6–7 / 7–8 AM) rows roll forward to today until the RO is closed or done.
import assert from "node:assert/strict";
import test from "node:test";
import { schedule } from "../app/tech-board/scheduler.ts";

const techs = [["AN", "Andrew Nelson"], ["SW", "Stacy Williams"]].map(([initials, name], i) => ({ initials, name, active: true, sortOrder: i, dailyHours: 8, dayMinutes: 480 }));
const opts = { today: "2026-11-04", now: "2026-11-04T13:00:00.000Z", keepToday: true };
const ro = (roNumber, customer) => ({ roNumber, label: "Part Arrived", section: "work-in-progress", vehicle: "Truck", customer, assignedInitials: ["AN"], ageDays: 2, soldHours: 1 });
const front = (board, n) => board.filter((job) => job.roNumber === n && !job.hidden && job.laneDate === "2026-11-04" && job.startMinute < 0);

test("yesterday's Tekmetric 6–7 AM appointment (gone from today's read) rolls to today's row", () => {
  const board = schedule([ro("38600", "Alpha")], [], techs, { ...opts, pastAppointments: [{ date: "2026-11-03", employee: "Stacy Williams", startMinute: -120, endMinute: -60, text: "RO #38600 Alpha" }] });
  const rows = front(board, "38600");
  assert.equal(rows.length, 1); assert.equal(rows[0].startMinute, -120); assert.equal(rows[0].tech, "SW");
  assert.equal(board.filter((job) => job.roNumber === "38600" && !job.hidden).length, 1, "no duplicate block");
});

test("stored past tekSchedule 7–8 AM appointment and prior board row both roll forward", () => {
  const board = schedule([ro("38601", "Beta"), ro("38602", "Gamma")], [
    { ro: "38602", roNumber: "38602", tech: "AN", laneDate: "2026-11-02", position: 0, startMinute: -120, pinned: false, placedBy: "auto", status: "front-office" }],
  techs, { ...opts, tekSchedule: [{ id: "x", ro: "38601", tech: "AN", date: "2026-11-03", startMinute: -60, endMinute: 0, key: "x" }] });
  assert.equal(front(board, "38601")[0]?.startMinute, -60);
  assert.equal(front(board, "38602")[0]?.startMinute, -120);
});

test("done / 100% tickets and writer moves out of the row are not pulled back", () => {
  const board = schedule([ro("38603", "Delta"), ro("38604", "Echo")], [
    { ro: "38604", roNumber: "38604", tech: "AN", laneDate: "2026-11-04", position: 0, startMinute: 0, pinned: true, placedBy: "writer", status: "diag" }],
  techs, { ...opts, progress: { "38603": { done: true, percent: 100 } },
    pastAppointments: ["38603", "38604"].map((n) => ({ date: "2026-11-03", employee: "Andrew Nelson", startMinute: -120, endMinute: -60, text: `#${n}` })) });
  assert.equal(front(board, "38603").length, 0);
  assert.equal(front(board, "38604").length, 0);
});
