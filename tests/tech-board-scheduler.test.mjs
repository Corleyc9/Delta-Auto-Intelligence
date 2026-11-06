// Run: node --experimental-strip-types --test tests/tech-board-scheduler.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { schedule, normalizeLabel, isNeedsDiag, isPartArrived, shopDays, remainingMinutes, laborHoursOf, DIAG_END, LUNCH_START, LUNCH_END, wallEnd, appointmentMinute } from "../app/tech-board/scheduler.ts";

const today = "2026-11-02"; // Monday
const ro = (roNumber, label, extra = {}) => ({ roNumber, label, section: "work-in-progress", vehicle: `Car ${roNumber}`, assignedInitials: [], ageDays: 1, soldHours: 2, ...extra });

test("label matching ignores case and extra spaces", () => {
  assert.equal(normalizeLabel("  NEEDS   Diag. "), "needs diag.");
  assert.ok(isNeedsDiag("Needs  DIAG"));
  assert.ok(isPartArrived("PART   arrived"));
  assert.ok(isPartArrived("Parts Arrived"));
});

test("shop days skip weekends", () => {
  assert.deepEqual(shopDays("2026-11-06", 3), ["2026-11-06", "2026-11-09", "2026-11-10"]);
});

test("8-10 AM is diag-only: Needs Diag goes there and regular work starts at 10", () => {
  const jobs = schedule([ro("1", "Needs Diag", { assignedInitials: ["MC"], soldHours: 0 }), ro("2", "In Progress", { assignedInitials: ["MC"], soldHours: 3 })], [], undefined, { today });
  const diag = jobs.find((j) => j.ro === "1"), work = jobs.find((j) => j.ro === "2");
  assert.equal(diag.tech, "MC"); assert.equal(diag.startMinute, 0); assert.ok(diag.inDiagBlock);
  assert.equal(work.startMinute, DIAG_END); // unused diag time is NOT given to regular work
  for (const j of jobs) if (j.status !== "diag") assert.ok(j.startMinute >= DIAG_END);
});

test("diag overflow goes to the next day's 8-10, never into regular time", () => {
  const orders = [1, 2, 3].map((n) => ro(String(n), "needs diag", { assignedInitials: ["AN"], soldHours: 1, ageDays: 10 - n }));
  const jobs = schedule(orders, [], undefined, { today });
  assert.deepEqual(jobs.map((j) => [j.ro, j.laneDate, j.startMinute]), [["1", today, 0], ["2", today, 60], ["3", "2026-11-03", 0]]);
  // Unassigned diags fill every tech's block (5 techs x 2 h) before spilling to tomorrow 8-10.
  const many = Array.from({ length: 11 }, (_, n) => ro(String(100 + n), "Needs Diag", { soldHours: 1, ageDays: 20 - n }));
  const placed = schedule(many, [], undefined, { today });
  assert.equal(placed.filter((j) => j.laneDate === today).length, 10);
  const spill = placed.find((j) => j.laneDate !== today);
  assert.equal(spill.laneDate, "2026-11-03"); assert.equal(spill.startMinute, 0);
  for (const j of placed) assert.ok(j.startMinute + j.durationMinutes <= DIAG_END);
  // A diag longer than the block is capped to the 2 h block.
  assert.equal(schedule([ro("9", "Needs Diag", { soldHours: 3 })], [], undefined, { today })[0].durationMinutes, 120);
});

test("carry-over: remaining = labor hours x (1 - % complete), same tech, first in line, flagged", () => {
  assert.equal(remainingMinutes(4, 50), 120);
  assert.equal(remainingMinutes(2.5, 0), 150);
  assert.equal(remainingMinutes(3, 75), 45);
  const existing = [
    { ro: "70", tech: "MB", laneDate: "2026-10-30", position: 0, startMinute: 300, pinned: false, placedBy: "auto", techEstimateHours: null, startedAt: null },
    { ro: "71", tech: "MB", laneDate: "2026-10-30", position: 1, startMinute: 120, pinned: false, placedBy: "auto", techEstimateHours: null, startedAt: null },
  ];
  const orders = [ro("70", "In Progress", { soldHours: 4 }), ro("71", "In Progress", { soldHours: 2 }), ro("72", "Part Arrived", { assignedInitials: ["MB"], soldHours: 1, ageDays: 40 })];
  const jobs = schedule(orders, existing, undefined, { today, progress: { "70": { percent: 50, done: false }, "71": { percent: 100, done: true } } });
  const carried = jobs.find((j) => j.ro === "70");
  assert.equal(carried.laneDate, today); assert.equal(carried.tech, "MB"); assert.equal(carried.carriedOver, true);
  assert.equal(carried.durationMinutes, 120); assert.equal(carried.startMinute, DIAG_END);
  assert.equal(jobs.find((j) => j.ro === "71"), undefined); // done work leaves the board
  assert.ok(jobs.find((j) => j.ro === "72").startMinute >= wallEnd(carried.startMinute, carried.durationMinutes)); // carry-over before Part Arrived
});

test("build order: Pre-Set at set time, diag, carry-over, Part Arrived, ready", () => {
  const appointments = [{ date: today, employee: "Mike Cook", startMinute: appointmentMinute("1:00 PM"), endMinute: appointmentMinute("3:00 PM"), text: "RO#80 Pre-Set Apt", color: "#fcb70d" }];
  const orders = [ro("80", "Pre-Set Apt", { soldHours: 2 }), ro("81", "Needs Diag", { assignedInitials: ["MC"], soldHours: 1 }),
    ro("82", "Part Arrived", { assignedInitials: ["MC"], soldHours: 2 }), ro("83", "In Progress", { assignedInitials: ["MC"], soldHours: 2 })];
  const jobs = schedule(orders, [], undefined, { today, appointments });
  const at = (id) => jobs.find((j) => j.ro === id);
  assert.equal(at("80").tech, "MC"); assert.equal(at("80").startMinute, 300); assert.equal(at("80").pinned, true);
  assert.equal(at("81").startMinute, 0);
  assert.equal(at("82").startMinute, 120); // 10-12
  assert.equal(at("83").laneDate, today); assert.equal(at("83").startMinute, 420); // after the 1-3 Pre-Set
  // A writer drag of a Pre-Set appointment holds at its new time.
  const moved = schedule(orders, [{ ro: "80", tech: "MC", laneDate: today, position: 0, startMinute: 420, pinned: true, placedBy: "writer", techEstimateHours: null, startedAt: null }], undefined, { today, appointments });
  assert.equal(moved.find((j) => j.ro === "80").startMinute, 420);
});

test("a dragged job is a preference, not a lock: it reflows", () => {
  const existing = [{ ro: "20", tech: "SW", laneDate: today, position: 0, startMinute: 300, pinned: true, placedBy: "writer", techEstimateHours: null, startedAt: null }];
  const jobs = schedule([ro("20", "In Progress", { soldHours: 2 }), ro("21", "In Progress", { assignedInitials: ["SW"], soldHours: 1 })], existing, undefined, { today });
  const moved = jobs.find((j) => j.ro === "20");
  assert.equal(moved.tech, "SW"); assert.equal(moved.startMinute, 300); assert.equal(moved.placedBy, "writer");
  assert.equal(jobs.find((j) => j.ro === "21").startMinute, 120);
  // Preferred slot taken by a Pre-Set appointment -> it reflows instead of overlapping.
  const appointments = [{ date: today, employee: "Stacy Williams", startMinute: 300, endMinute: 420, text: "RO 22 Pre-Set", color: "#fcb70d" }];
  const reflow = schedule([ro("20", "In Progress", { soldHours: 2 }), ro("22", "Pre-Set Apt", { soldHours: 2 })], existing, undefined, { today, appointments });
  const r20 = reflow.find((j) => j.ro === "20");
  assert.equal(r20.tech, "SW"); assert.notEqual(r20.startMinute, 300);
});

test("part arrived oldest first, before other ready work", () => {
  const orders = [ro("10", "In Progress", { assignedInitials: ["BC"], ageDays: 30, soldHours: 1 }), ro("11", "Part Arrived", { assignedInitials: ["BC"], ageDays: 2, soldHours: 1 }), ro("12", "part arrived", { assignedInitials: ["BC"], ageDays: 5, soldHours: 1 })];
  const jobs = schedule(orders, [], undefined, { today }).sort((a, b) => a.startMinute - b.startMinute);
  assert.deepEqual(jobs.map((j) => j.ro), ["12", "11", "10"]);
});

test("overflow rolls to next day; unassigned goes to most open tech; tech estimate overrides LG", () => {
  const orders = [ro("30", "In Progress", { assignedInitials: ["MB"], soldHours: 5 }), ro("31", "In Progress", { assignedInitials: ["MB"], soldHours: 4 }), ro("32", "In Progress", { soldHours: 2 })];
  const existing = [{ ro: "32", tech: "MC", laneDate: today, position: 0, startMinute: 0, pinned: false, placedBy: "auto", techEstimateHours: 0.5, startedAt: null }];
  const jobs = schedule(orders, existing, undefined, { today });
  assert.equal(jobs.find((j) => j.ro === "31").laneDate, "2026-11-03");
  const floater = jobs.find((j) => j.ro === "32");
  assert.notEqual(floater.tech, "MB"); assert.equal(floater.durationMinutes, 30);
});

test("block length uses real synced labor hours (reader soldHours, decimal hours)", () => {
  // Real-shaped job_board_snapshots item: card "0 / 2.4 hrs" -> soldHours 2.4.
  const synced = { roNumber: "44521", section: "work-in-progress", label: "In-Progress", customer: "Alex Rivera", vehicle: "2019 Chevrolet Silverado",
    assignedInitials: ["AW", "MC"], ageDays: 2, soldHours: 2.4, detailUrl: "https://shop.tekmetric.com/admin/shop/1/repair-orders/44521" };
  assert.equal(laborHoursOf(synced), 2.4);
  const [job] = schedule([synced], [], undefined, { today });
  assert.equal(job.durationMinutes, 144); assert.equal(job.laborGuideHours, 2.4);
  // Card shows "0 / 0" but a webhook / earlier sync saw 1.5 h -> 90 min, not the 1 h default.
  const [fallback] = schedule([{ ...synced, soldHours: 0, knownLaborHours: 1.5, label: "Part Arrived" }], [], undefined, { today });
  assert.equal(fallback.durationMinutes, 90);
  // Priority: manual resize > tech estimate > labor hours.
  const [est] = schedule([synced], [{ ro: "44521", tech: "MC", laneDate: today, position: 0, startMinute: 120, pinned: false, placedBy: "auto", techEstimateHours: 3, startedAt: null }], undefined, { today });
  assert.equal(est.durationMinutes, 180);
  const [resized] = schedule([synced], [{ ro: "44521", tech: "MC", laneDate: today, position: 0, startMinute: 120, pinned: false, placedBy: "auto", techEstimateHours: 3, startedAt: null, durationOverrideMinutes: 75 }], undefined, { today });
  assert.equal(resized.durationMinutes, 75);
});

test("estimates and blocked labels are not scheduled", () => {
  const jobs = schedule([ro("40", "Waiting on Parts"), ro("41", "In Progress", { section: "estimates" }), ro("42", "Verify")], [], undefined, { today });
  assert.equal(jobs.length, 0);
});

test("lunch 12-1 is never scheduled; work flows around it", () => {
  const jobs = schedule([ro("50", "In Progress", { assignedInitials: ["MC"], soldHours: 3 }), ro("51", "In Progress", { assignedInitials: ["MC"], soldHours: 2 })], [], undefined, { today });
  const first = jobs.find((j) => j.ro === "50");
  assert.equal(first.startMinute, 120); // 10:00
  assert.equal(wallEnd(first.startMinute, first.durationMinutes), 360); // 3h from 10 spans lunch -> ends 2:00
  assert.equal(jobs.find((j) => j.ro === "51").startMinute, 360);
  for (const j of jobs) assert.ok(!(j.startMinute >= LUNCH_START && j.startMinute < LUNCH_END));
});

test("time off blocks capacity and writer resize / custom blocks / hidden ROs persist", () => {
  const timeOff = [{ id: 1, initials: "BC", date: today, startMinute: 0, endMinute: 0, allDay: true, reason: "Vacation" }];
  const existing = [
    { ro: "C-1", tech: "AN", laneDate: today, position: 0, startMinute: 0, pinned: true, placedBy: "writer", techEstimateHours: null, startedAt: null, custom: true, title: "Shop meeting", note: "", durationOverrideMinutes: 60 },
    { ro: "61", tech: "AN", laneDate: today, position: 1, startMinute: 120, pinned: true, placedBy: "writer", techEstimateHours: null, startedAt: null, durationOverrideMinutes: 45 },
    { ro: "62", tech: "AN", laneDate: today, position: 0, startMinute: 0, pinned: false, placedBy: "writer", techEstimateHours: null, startedAt: null, hidden: true },
  ];
  const jobs = schedule([ro("60", "In Progress", { assignedInitials: ["BC"], soldHours: 2 }), ro("61", "In Progress", { soldHours: 3 }), ro("62", "In Progress")], existing, undefined, { today, timeOff });
  assert.equal(jobs.find((j) => j.ro === "60").laneDate, "2026-11-03"); // BC off all day today
  assert.equal(jobs.find((j) => j.ro === "C-1").title, "Shop meeting");
  assert.equal(jobs.find((j) => j.ro === "61").durationMinutes, 45);
  assert.equal(jobs.find((j) => j.ro === "62").hidden, true);
});
