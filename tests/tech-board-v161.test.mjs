// v1.6.1: no event floods — only real transitions; stale events (>10 min) are never posted.
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ensureEvents, recordUpdateEvent, recordTekmetricChanges, tekmetricChanges, deliverEvent, listEvents, knownTech } from "../app/tech-board/events.ts";

function d1() {
  const sqlite = new DatabaseSync(":memory:");
  const stmt = (sql, values = []) => ({ bind: (...v) => stmt(sql, v), run: async () => sqlite.prepare(sql).run(...values),
    first: async () => sqlite.prepare(sql).get(...values) ?? null, all: async () => ({ results: sqlite.prepare(sql).all(...values) }) });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } };
}
const at = (m, s = 0) => new Date(Date.UTC(2026, 10, 3, 16, m, s)).toISOString();
const ro = (jobs) => [{ roNumber: "38001", customer: "Ana", label: "In-Progress", jobs }];

test("id resolving to a name, first sightings, tech appearing/disappearing, reopen: no events", async () => {
  const db = d1(); await ensureEvents(db);
  assert.equal((await recordTekmetricChanges(db, ro([{ jobId: "1", name: "Alt", technician: "#72853", completed: false }]), at(0))).length, 0, "first sighting");
  assert.equal((await recordTekmetricChanges(db, ro([{ jobId: "1", name: "Alt", technician: "MIKE COOK", completed: false }]), at(1))).length, 0, "#id → name");
  assert.equal((await recordTekmetricChanges(db, ro([{ jobId: "1", name: "Alt", technician: "#72853", completed: false }]), at(2))).length, 0, "name → #id");
  assert.equal((await recordTekmetricChanges(db, ro([{ jobId: "1", name: "Alt", technician: "Mike Cook", completed: false }]), at(3))).length, 0, "case only");
  assert.equal((await recordTekmetricChanges(db, ro([{ jobId: "1", name: "Alt", technician: "", completed: false }]), at(4))).length, 0, "unassigned");
  assert.equal((await recordTekmetricChanges(db, ro([{ jobId: "2", name: "New", technician: "Beau Corley", completed: true }]), at(5))).length, 0, "new job already completed");
  assert.equal(tekmetricChanges(new Map([["38001|2", { completed: true, technician: "Beau Corley" }]]), "38001", [{ jobId: "2", name: "New", technician: "Beau Corley", completed: false }]).length, 0, "reopen");
  assert.equal(knownTech("#123"), false); assert.equal(knownTech("Mike Cook"), true);
});

test("real reassignment between two known techs and a job turning Completed do emit", async () => {
  const db = d1(); await ensureEvents(db);
  await recordTekmetricChanges(db, ro([{ jobId: "1", name: "Alt", technician: "Mike Cook", completed: false }]), at(0));
  await recordTekmetricChanges(db, ro([{ jobId: "1", name: "Alt", technician: "#999", completed: false }]), at(1)); // keeps Mike Cook
  const moved = await recordTekmetricChanges(db, ro([{ jobId: "1", name: "Alt", technician: "Beau Corley", completed: false }]), at(2));
  assert.equal(moved.length, 1);
  const done = await recordTekmetricChanges(db, ro([{ jobId: "1", name: "Alt", technician: "Beau Corley", completed: true }]), at(3));
  assert.equal(done.length, 1);
  const messages = (await listEvents(db, 0, at(4))).events.map((e) => e.message);
  assert.deepEqual(messages, ["Ana · RO#38001 · Alt · Beau Corley: Tekmetric tech changed from Mike Cook to Beau Corley", "Ana · RO#38001 · Alt · Beau Corley: Tekmetric shows the job completed"]);
});

test("buttons, comments and % changes emit; repeating the same % does not", async () => {
  const db = d1(); await ensureEvents(db);
  const job = { ro: "38001", roNumber: "38001", customer: "Ana", jobName: "Alt" };
  const base = { job, techName: "Mike Cook", source: "tech" };
  for (const [i, kind] of ["Need parts", "Wrong part", "Need help", "Waiting approval", "Found more work", "Diag Done", "Done"].entries())
    assert.ok(await recordUpdateEvent(db, { ...base, kind, percent: null, comment: "", now: at(0, i) }), kind);
  assert.ok(await recordUpdateEvent(db, { ...base, kind: "note", percent: null, comment: "Customer called", now: at(1) }));
  assert.equal(await recordUpdateEvent(db, { ...base, kind: "note", percent: null, comment: "", now: at(1, 5) }), null, "empty note");
  assert.ok(await recordUpdateEvent(db, { ...base, kind: "note", percent: 25, comment: "", now: at(2) }));
  assert.equal(await recordUpdateEvent(db, { ...base, kind: "note", percent: 25, comment: "", now: at(3) }), null, "same %");
});

test("events older than 10 minutes are never posted (instant or poll) and are marked posted silently", async () => {
  const db = d1(); await ensureEvents(db);
  const job = { ro: "38001", roNumber: "38001", customer: "Ana", jobName: "Alt" };
  const old = await recordUpdateEvent(db, { job, techName: "Mike Cook", kind: "Need parts", percent: null, comment: "", source: "tech", now: at(0) });
  const fresh = await recordUpdateEvent(db, { job, techName: "Mike Cook", kind: "Need help", percent: null, comment: "", source: "tech", now: at(10) });
  let calls = 0;
  const ok = async () => { calls += 1; return { ok: true }; };
  assert.equal(await deliverEvent(db, old.id, "https://example.invalid", ok, () => at(11)), false);
  assert.equal(calls, 0, "stale event not sent to the webhook");
  const feed = await listEvents(db, 0, at(12));
  assert.deepEqual(feed.events.map((e) => e.id), [fresh.id], "stale one gone from the poll feed");
  assert.equal((await listEvents(db, 0, at(25))).events.length, 0, "fresh one went stale too and was marked posted");
});
