// v1.6.4: Teams delivery diagnostics — each send's HTTP status + error body is logged (URL never stored/returned).
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ensureEvents, recordUpdateEvent, deliverEvent, postCard, notifyStatus, teamsCard } from "../app/tech-board/events.ts";

function d1() {
  const sqlite = new DatabaseSync(":memory:");
  const stmt = (sql, values = []) => ({ bind: (...v) => stmt(sql, v), run: async () => sqlite.prepare(sql).run(...values),
    first: async () => sqlite.prepare(sql).get(...values) ?? null, all: async () => ({ results: sqlite.prepare(sql).all(...values) }) });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } };
}
const URL = "https://prod-00.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?api-version=1&sig=SECRET123";
const at = (s) => new Date(Date.UTC(2026, 10, 3, 17, 0, s)).toISOString();

test("a 4xx from the Workflow is logged with status and body; the URL/sig never appear", async () => {
  const db = d1(); await ensureEvents(db);
  const ev = await recordUpdateEvent(db, { job: { ro: "38470", roNumber: "38470", customer: "J", jobName: "Diag" }, techName: "Andrew Nelson", kind: "Wrong part", percent: null, comment: "", source: "tech", now: at(0) });
  const bad = async () => ({ ok: false, status: 400, text: async () => `{"error":{"code":"TriggerInputSchemaMismatch","message":"bad body for ${URL}"}}` });
  assert.equal(await deliverEvent(db, ev.id, URL, bad, () => at(5)), false);
  const status = await notifyStatus(db, true);
  assert.equal(status.secretSet, true);
  assert.equal(status.recentFailures[0].status, 400);
  assert.match(status.recentFailures[0].error, /TriggerInputSchemaMismatch/);
  assert.ok(!JSON.stringify(status).includes("SECRET123") && !JSON.stringify(status).includes("logic.azure.com"));
  // a later success is recorded and the event is marked posted
  assert.equal(await deliverEvent(db, ev.id, URL, async () => ({ ok: true, status: 202, text: async () => "" }), () => at(9)), true);
  assert.equal((await notifyStatus(db, true)).lastSuccess.status, 202);
});

test("network errors are captured, not thrown", async () => {
  const result = await postCard(URL, teamsCard("update", "x"), async () => { throw new Error(`connect ECONNREFUSED ${URL}`); });
  assert.equal(result.ok, false); assert.equal(result.status, null);
  assert.ok(!result.error.includes("SECRET123"));
});
