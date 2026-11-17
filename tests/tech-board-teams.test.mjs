// v1.6: instant Teams Workflow webhook posting (Adaptive Card), mark posted on success, keep unposted on failure.
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ensureEvents, recordUpdateEvent, deliverEvent, teamsCard, listEvents, DEBOUNCE_MS } from "../app/tech-board/events.ts";

function d1() {
  const sqlite = new DatabaseSync(":memory:");
  const stmt = (sql, values = []) => ({ bind: (...v) => stmt(sql, v), run: async () => sqlite.prepare(sql).run(...values),
    first: async () => sqlite.prepare(sql).get(...values) ?? null, all: async () => ({ results: sqlite.prepare(sql).all(...values) }) });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } };
}
const at = (s) => new Date(Date.UTC(2026, 10, 3, 16, 0, s)).toISOString();
const job = { ro: "38001-J2", roNumber: "38001", customer: "Ana", jobName: "Alternator" };
const URL = "https://example.invalid/workflow";

test("Adaptive Card body matches the 'Send webhook alerts to a channel' template", () => {
  assert.deepEqual(teamsCard("complete", "Ana · RO#38001 · Alternator · Mike Cook: Done"), { type: "message", attachments: [{
    contentType: "application/vnd.microsoft.card.adaptive", content: { type: "AdaptiveCard", version: "1.4",
      body: [{ type: "TextBlock", text: "✅ Complete: Ana · RO#38001 · Alternator · Mike Cook: Done", wrap: true }] } }] });
  assert.equal(teamsCard("update", "x").attachments[0].content.body[0].text, "🔧 Update: x");
});

test("success marks posted (feed skips it); failure leaves it for the backup poll; no URL posts nothing", async () => {
  const db = d1(); await ensureEvents(db);
  const sent = [];
  const ok = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true }; };
  const a = await recordUpdateEvent(db, { job, techName: "Mike Cook", kind: "Need parts", percent: null, comment: "", source: "tech", now: at(0) });
  assert.equal(a.delayMs, 0);
  assert.equal(await deliverEvent(db, a.id, "", ok, () => at(30)), false);
  assert.equal(sent.length, 0);
  assert.equal(await deliverEvent(db, a.id, URL, ok, () => at(30)), true);
  assert.equal(sent[0].body.attachments[0].content.body[0].text, "🔧 Update: Ana · RO#38001 · Alternator · Mike Cook: Need parts");
  assert.equal(await deliverEvent(db, a.id, URL, ok, () => at(30)), false, "never posts twice");

  const b = await recordUpdateEvent(db, { job, techName: "Mike Cook", kind: "Done", percent: null, comment: "", source: "tech", now: at(10) });
  assert.equal(await deliverEvent(db, b.id, URL, async () => ({ ok: false }), () => at(30)), false);
  assert.equal(await deliverEvent(db, b.id, URL, async () => { throw new Error("down"); }, () => at(30)), false);
  const feed = await listEvents(db, 0, at(300));
  assert.deepEqual(feed.events.map((e) => e.id), [b.id], "only the failed one is left for the poll");
});

test("dedupe kept; % changes debounce 20 s per job, then a new event", async () => {
  const db = d1(); await ensureEvents(db);
  const base = { job, techName: "Mike Cook", comment: "", source: "tech" };
  assert.equal((await recordUpdateEvent(db, { ...base, kind: "Need help", percent: null, now: at(0) })).id > 0, true);
  assert.equal(await recordUpdateEvent(db, { ...base, kind: "Need help", percent: null, now: at(3) }), null, "deduped");
  const first = await recordUpdateEvent(db, { ...base, kind: "note", percent: 25, now: at(10) });
  assert.equal(first.delayMs, DEBOUNCE_MS);
  assert.equal(await recordUpdateEvent(db, { ...base, kind: "note", percent: 50, now: at(25) }), null, "folded into the pending send");
  const sent = [];
  await deliverEvent(db, first.id, URL, async (u, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; }, () => at(30));
  assert.match(sent[0].attachments[0].content.body[0].text, /50% complete$/);
  const later = await recordUpdateEvent(db, { ...base, kind: "note", percent: 75, now: at(40) });
  assert.ok(later && later.id !== first.id);
});
