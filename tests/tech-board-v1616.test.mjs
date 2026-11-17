// v1.6.16: auto-place approved jobs (Tekmetric tech, else skill chart; today only; else "Needs placing") and ripple on move/resize.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { schedule, ripple, toTekSchedule } from "../app/tech-board/scheduler.ts";
import { jobCategory, eligibleTechs } from "../app/tech-board/skills.ts";

const techs = [["SW", "Stacy Williams"], ["AN", "Andrew Nelson"], ["MC", "Mike Cook"], ["BC", "Beau Corley"], ["MB", "Mario Butler"]]
  .map(([initials, name], i) => ({ initials, name, active: true, sortOrder: i, dayMinutes: 480, diagBlockMinutes: 120, dayStartMinute: 480 }));
const opts = { today: "2026-11-04", now: "2026-11-04T13:00:00.000Z", keepToday: true, approvedOnly: true, autoPlace: true };
const ro = (n, name, hours, extra = {}, job = {}) => ({ roNumber: n, label: "Ready", section: "work-in-progress", vehicle: "Truck", customer: `CUST ${n}`, ageDays: 1,
  jobs: [{ jobId: "1", name, hours, order: 1, approved: true, techInitials: null, technician: null, ...job }], ...extra });
const live = (board, n) => board.find((job) => job.roNumber === n && !job.hidden);

test("skill chart: HVAC/electrical/drivability → masters; brakes → B first; lube → Mario first; hybrid → Devin only", () => {
  assert.deepEqual(eligibleTechs(jobCategory("A/C not cold diag"), techs), ["SW", "AN"]);
  assert.deepEqual(eligibleTechs(jobCategory("Diag no communication with ECM"), techs), ["SW", "AN"]);
  assert.deepEqual(eligibleTechs(jobCategory("Misfire diag P0301"), techs), ["SW", "AN"]);
  assert.deepEqual(eligibleTechs(jobCategory("Front brakes pads and rotors"), techs), ["MC", "BC", "SW", "AN"]);
  assert.deepEqual(eligibleTechs(jobCategory("Coolant leak pressure test", "", true), techs), ["MC", "BC", "SW", "AN"]);
  assert.deepEqual(eligibleTechs(jobCategory("Oil change"), techs), ["MB", "MC", "BC", "SW", "AN"]);
  assert.deepEqual(eligibleTechs(jobCategory("Hybrid battery replace"), techs), []);
  assert.deepEqual(eligibleTechs(jobCategory("Hybrid battery replace"), [...techs, { initials: "DC", name: "Devin Corley" }]), ["DC"]);
});

test("approved job with a Tekmetric tech goes on that tech's first open slot today, flagged auto-placed", () => {
  const board = schedule([ro("38586", "Replace water pump", 2, {}, { techInitials: "SW", technician: "Stacy" })], [], techs, opts);
  const job = live(board, "38586");
  assert.equal(job.tech, "SW"); assert.equal(job.laneDate, "2026-11-04"); assert.equal(job.startMinute, 120); assert.equal(job.autoPlaced, true);
});

test("unassigned job uses the skill chart; brake job goes to a B-level tech, never Mario", () => {
  const board = schedule([ro("40001", "Rear brakes", 1.5)], [], techs, opts);
  const job = live(board, "40001");
  assert.ok(["MC", "BC"].includes(job.tech)); assert.equal(job.autoPlaced, true);
});

test("diag lands in the 8–10 needs-diag window", () => {
  const board = schedule([ro("40002", "Diag check engine light", 1, { label: "Needs Diag" })], [], techs, opts);
  const job = live(board, "40002");
  assert.ok(["SW", "AN"].includes(job.tech)); assert.ok(job.startMinute >= 0 && job.startMinute + 60 <= 120);
});

test("no tech fits or day full → Needs placing (Unassigned, today), never a later day", () => {
  const hybrid = live(schedule([ro("40003", "Hybrid inverter diag", 1)], [], techs, opts), "40003");
  assert.equal(hybrid.tech, "UN"); assert.match(hybrid.needsPlacing, /Devin/);
  const full = [{ ro: "C-1", tech: "SW", laneDate: "2026-11-04", position: 0, startMinute: 120, pinned: true, placedBy: "writer", custom: true, title: "Big job", durationMinutes: 360 }];
  const job = live(schedule([ro("40004", "Engine swap", 3, {}, { techInitials: "SW", technician: "Stacy" })], full, techs, opts), "40004");
  assert.equal(job.tech, "UN"); assert.equal(job.laneDate, "2026-11-04"); assert.match(job.needsPlacing, /full/);
});

test("never overlaps a yellow Tekmetric appointment", () => {
  const rows = [{ id: "9", roNumber: "", employeeId: "1", employeeName: "Stacy Williams", start: "2026-11-04T16:00:00Z", end: "2026-11-04T17:00:00Z", updated: "u", color: "#FCB70D", customer: "Ann Lee", title: "" }];
  const board = schedule([ro("40005", "Water pump", 1, {}, { techInitials: "SW", technician: "Stacy" })], [], techs, { ...opts, tekSchedule: toTekSchedule(rows, techs) });
  const appt = board.find((job) => job.ro === "APPT-9"); const job = live(board, "40005");
  assert.equal(appt.startMinute, 120);
  assert.ok(job.startMinute >= 180 || job.startMinute + 60 <= 120, `placed at ${job.startMinute}`);
});

test("idempotent: re-running with the board's own output changes nothing and adds no duplicates; hand blocks stand in", () => {
  const orders = [ro("40006", "Front brakes", 1)];
  const first = schedule(orders, [], techs, opts);
  const again = schedule(orders, first.map((job) => ({ ...job })), techs, opts);
  assert.equal(again.filter((job) => job.roNumber === "40006").length, 1);
  assert.deepEqual([live(again, "40006").tech, live(again, "40006").startMinute], [live(first, "40006").tech, live(first, "40006").startMinute]);
  const hand = [{ ro: "C-2", tech: "MC", laneDate: "2026-11-04", position: 0, startMinute: 300, pinned: true, placedBy: "writer", custom: true, linkedRo: "40006", title: "brakes", durationMinutes: 60 }];
  const withHand = schedule(orders, hand, techs, opts);
  assert.equal(withHand.filter((job) => !job.custom && job.roNumber === "40006").length, 0);
});

const lane = (key, start, dur, extra = {}) => ({ key, tech: "SW", laneDate: "2026-11-04", startMinute: start, durationMinutes: dur, ...extra });

test("ripple: moving a block into later ones pushes them later in order", () => {
  const moves = ripple([lane("A", 120, 120), lane("B", 180, 60), lane("C", 360, 60)], "A");
  assert.deepEqual(moves.map((m) => [m.key, m.startMinute]), [["B", 300]]); // B → 1 PM (after lunch); C already clear
});

test("ripple hops over locked yellow appointments and never moves them", () => {
  const moves = ripple([lane("A", 120, 60), lane("B", 150, 60), lane("Y", 180, 60, { locked: true })], "A");
  assert.deepEqual(moves.map((m) => [m.key, m.startMinute]), [["B", 300]]);
  assert.ok(!moves.some((m) => m.key === "Y"));
});

test("ripple flags overflow past 5 PM instead of dropping; earlier blocks and other techs untouched", () => {
  const moves = ripple([lane("E", 0, 60), lane("A", 300, 180), lane("B", 360, 120), { ...lane("O", 360, 60), tech: "AN" }], "A");
  assert.deepEqual(moves, [{ key: "B", from: 360, startMinute: 480, overflow: true }]);
});

test("ripple wired into writer/bot move + resize and the tech's own update", () => {
  const actions = readFileSync(new URL("../app/tech-board/actions.ts", import.meta.url), "utf8");
  assert.equal((actions.match(/await applyRipple\(db/g) || []).length, 3);
  assert.ok(readFileSync(new URL("../app/api/tech/route.ts", import.meta.url), "utf8").includes("item.tech === initials);\n    if (own && await applyRipple"));
  assert.ok(readFileSync(new URL("../app/tech-board/store.ts", import.meta.url), "utf8").includes("autoPlace: true"));
});
