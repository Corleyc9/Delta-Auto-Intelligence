// v1.5: Tekmetric job status + logged time, Teams events feed (dedupe, 1-minute % batching, ack), lunch span.
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { expandJobs, cardSpan, isStalled, expectedEnd, LUNCH_START, LUNCH_END } from "../app/tech-board/scheduler.ts";
import { normalizeJobs } from "../app/tech-board/ro-jobs.ts";
import { ensureEvents, recordUpdateEvent, recordTekmetricChanges, listEvents, ackEvents, eventType, eventMessage, describeUpdate } from "../app/tech-board/events.ts";

function d1() {
  const sqlite = new DatabaseSync(":memory:");
  const stmt = (sql, values = []) => ({
    bind: (...v) => stmt(sql, v),
    run: async () => sqlite.prepare(sql).run(...values),
    first: async () => sqlite.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } };
}
const techs = [{ initials: "BC", name: "Beau Corley" }, { initials: "MC", name: "Mike Cook" }];
const at = (seconds) => new Date(Date.UTC(2026, 10, 3, 15, 0, seconds)).toISOString();

test("reader jobs keep technician, logged time and done; roster name beats derived initials", () => {
  const jobs = normalizeJobs([{ jobId: "1", name: "Diag", technician: "MIKE COOK", techInitials: "XX", hours: 1, completed: true, loggedSeconds: 4320 },
    { jobId: "2", name: "Brakes", technician: "Beau Corley", techInitials: "BC", hours: 2, completed: false, loggedSeconds: 0 }], techs);
  assert.equal(jobs[0].techInitials, "MC");
  assert.equal(jobs[0].loggedSeconds, 4320);
  assert.equal(jobs[0].completed, true);
  assert.equal(jobs[1].technician, "Beau Corley");
});

test("completed jobs drop off; an RO whose jobs are all Completed in Tekmetric leaves the board", () => {
  const base = { roNumber: "37906", label: "In-Progress", section: "work-in-progress", vehicle: "Truck", customer: "C", soldHours: 3 };
  const mixed = expandJobs([{ ...base, jobs: [{ jobId: "1", name: "A", hours: 1, order: 1, completed: true }, { jobId: "2", name: "B", hours: 2, order: 2, loggedSeconds: 600 }] }]);
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0].jobName, "B");
  assert.equal(mixed[0].loggedSeconds, 600);
  assert.equal(expandJobs([{ ...base, jobs: [{ jobId: "1", name: "A", hours: 1, order: 1, completed: true }] }]).length, 0);
});

test("lunch span: 2 h starting 11:00 is one block ending 2:00 with lunch shaded inside; stalled uses the adjusted end", () => {
  const start = 180; // 11:00 (minutes from 8:00)
  const span = cardSpan(start, 120);
  assert.equal(span.start, 180);
  assert.equal(span.end, 360); // 2:00 PM
  assert.deepEqual(span.lunch, { offset: LUNCH_START - 180, minutes: LUNCH_END - LUNCH_START });
  assert.equal(expectedEnd(start, 120), 360);
  assert.equal(isStalled(start, 120, 330), false); // 1:30 is not late — lunch pushed the end to 2:00
  assert.equal(isStalled(start, 120, 361), true);
  assert.equal(isStalled(start, 120, 361, true), false);
  assert.equal(cardSpan(0, 60).lunch, null);
});

test("events: formatted, typed, deduped, % debounced within 20 s, acked", async () => {
  const db = d1();
  await ensureEvents(db);
  const job = { ro: "37906-J2", roNumber: "37906", customer: "Chempro", jobName: "Brakes", tech: "BC" };
  assert.equal(eventType("Done", null), "complete");
  assert.equal(eventType("note", 100), "complete");
  assert.equal(eventType("Need parts", 50), "update");
  assert.equal(eventMessage(job, "Beau Corley", "Need parts"), "Chempro · RO#37906 · Brakes · Beau Corley: Need parts");
  assert.ok(!/pin/i.test(describeUpdate("note", 25, "")));

  await recordUpdateEvent(db, { job, techName: "Beau Corley", kind: "Need parts", percent: null, comment: "", source: "tech", now: at(0) });
  await recordUpdateEvent(db, { job, techName: "Beau Corley", kind: "Need parts", percent: null, comment: "", source: "tech", now: at(5) }); // dup
  await recordUpdateEvent(db, { job, techName: "Beau Corley", kind: "note", percent: 25, comment: "", source: "tech", now: at(10) });
  await recordUpdateEvent(db, { job, techName: "Beau Corley", kind: "note", percent: 50, comment: "", source: "tech", now: at(25) }); // folded (20 s)
  let feed = await listEvents(db, 0, at(50));
  assert.equal(feed.events.length, 1, "backup poll waits out the instant-send grace");
  feed = await listEvents(db, 0, at(90));
  assert.deepEqual(feed.events.map((e) => e.message), ["Chempro · RO#37906 · Brakes · Beau Corley: Need parts", "Chempro · RO#37906 · Brakes · Beau Corley: 50% complete"]);
  await recordUpdateEvent(db, { job, techName: "Beau Corley", kind: "Done", percent: null, comment: "", source: "writer", now: at(100) });
  await recordUpdateEvent(db, { job, techName: "Beau Corley", kind: "note", percent: 100, comment: "", source: "writer", now: at(200) }); // same completion
  feed = await listEvents(db, feed.cursor, at(300));
  assert.equal(feed.events.length, 1);
  assert.equal(feed.events[0].type, "complete");
  const all = await listEvents(db, 0, at(300));
  assert.equal(await ackEvents(db, all.events.map((e) => e.id), at(301)), 3);
  assert.equal((await listEvents(db, 0, at(302))).events.length, 0);
});

test("events: reader-detected Tekmetric completion; first sighting is silent", async () => {
  const db = d1();
  await ensureEvents(db);
  const order = (completed) => [{ roNumber: "38001", customer: "Ana", label: "In-Progress", jobs: [
    { jobId: "1", name: "Oil change", technician: "Beau Corley", completed: false }, { jobId: "2", name: "Alternator", technician: "Mike Cook", completed }] }];
  assert.equal((await recordTekmetricChanges(db, order(false), at(0))).length, 0);
  assert.equal((await recordTekmetricChanges(db, order(true), at(60))).length, 1);
  assert.equal((await recordTekmetricChanges(db, order(true), at(120))).length, 0);
  const [event] = (await listEvents(db, 0, at(200))).events;
  assert.equal(event.type, "complete");
  assert.equal(event.message, "Ana · RO#38001 · Alternator · Mike Cook: Tekmetric shows the job completed");
});

test("open pool = Tekmetric's Unassigned jobs: a job with no tech never inherits the RO card initials (writer/other techs)", async () => {
  const { schedule } = await import("../app/tech-board/scheduler.ts");
  const order = { roNumber: "38576", label: "In-Progress", section: "work-in-progress", vehicle: "2014 Kia Optima", customer: "C S",
    assignedInitials: ["DC", "MC"], ageDays: 1, soldHours: 5.6,
    jobs: normalizeJobs([{ jobId: "11", name: "Diagnostic Test", technician: null, hours: 1, completed: false },
      { jobId: "12", name: "High Voltage", technician: "MIKE COOK", hours: 4.6, completed: false }], [...techs, { initials: "DC", name: "Devin Corley" }]) };
  const units = expandJobs([order]);
  assert.deepEqual(units.map((unit) => unit.assignedInitials), [[], ["MC"]]);
  const board = schedule([order], [], [{ initials: "MC", name: "Mike Cook", active: true, sortOrder: 1, dailyHours: 8 }, { initials: "DC", name: "Devin Corley", active: true, sortOrder: 2, dailyHours: 8 }],
    { today: "2026-11-03", now: "2026-11-03T14:00:00.000Z" });
  const diag = board.find((job) => job.jobName === "Diagnostic Test");
  assert.equal(diag.tech, "UN");
});
