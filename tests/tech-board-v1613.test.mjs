// v1.6.13: writers can move yellow appointments (moves stick across syncs); appointment detail reaches the cards.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { schedule, toTekSchedule } from "../app/tech-board/scheduler.ts";

const techs = [["MB", "Mario Butler"], ["SW", "Stacy Williams"]].map(([initials, name], i) => ({ initials, name, active: true, sortOrder: i, dailyHours: 8, dayMinutes: 480 }));
const opts = { today: "2026-11-04", now: "2026-11-04T13:00:00.000Z", keepToday: true };
const details = JSON.stringify({ "Concern / notes": "oil change and check brakes", Vehicle: "1998 GMC C1500 Sierra SL", Phone: "6015550100" });
const row = { id: "75294303", roNumber: "", employeeId: "9", employeeName: "Mario Butler", start: "2026-11-04T14:00:00Z", end: "2026-11-04T14:45:00Z", updated: "u", color: "#FCB70D", customer: "Tim Lindsay", title: "", details };

test("no-RO yellow block carries the appointment detail and vehicle", () => {
  const block = schedule([], [], techs, { ...opts, tekSchedule: toTekSchedule([row], techs) }).find((job) => job.ro === "APPT-75294303");
  assert.equal(block.apptInfo, details); assert.equal(block.vehicle, "1998 GMC C1500 Sierra SL");
});

test("Devin's move/resize of a no-RO yellow block sticks on the next sync", () => {
  const tek = toTekSchedule([row], techs);
  const existing = [{ ro: "APPT-75294303", tech: "SW", laneDate: "2026-11-04", position: 0, startMinute: 120, pinned: true, placedBy: "writer", custom: true, apptKey: tek[0].key, durationOverrideMinutes: 90, title: "x" }];
  const block = schedule([], existing, techs, { ...opts, tekSchedule: tek }).find((job) => job.ro === "APPT-75294303");
  assert.deepEqual([block.tech, block.startMinute, block.durationMinutes, block.placedBy], ["SW", 120, 90, "writer"]);
});

test("a changed Tekmetric appointment resets to Tekmetric's time", () => {
  const tek = toTekSchedule([{ ...row, updated: "u2" }], techs);
  const existing = [{ ro: "APPT-75294303", tech: "SW", laneDate: "2026-11-04", position: 0, startMinute: 120, pinned: true, placedBy: "writer", custom: true, apptKey: "old", title: "x" }];
  const block = schedule([], existing, techs, { ...opts, tekSchedule: tek }).find((job) => job.ro === "APPT-75294303");
  assert.deepEqual([block.tech, block.startMinute], ["MB", 0]);
});

test("server allows writer/bot moves of yellow blocks; tech route has no move; both views render appointment detail", () => {
  const actions = readFileSync(new URL("../app/tech-board/actions.ts", import.meta.url), "utf8");
  assert.ok(!actions.includes("Locked: yellow"));
  const tech = readFileSync(new URL("../app/api/tech/route.ts", import.meta.url), "utf8");
  assert.ok(!/action === "move"/.test(tech));
  for (const file of ["TechBoardPanel.tsx", "TechPage.tsx"]) {
    const src = readFileSync(new URL(`../app/tech-board/${file}`, import.meta.url), "utf8");
    assert.ok(src.includes("<ApptDetails") && src.includes("apptSummary("), file);
  }
});
