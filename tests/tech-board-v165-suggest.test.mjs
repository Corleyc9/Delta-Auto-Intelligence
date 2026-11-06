// v1.6.5: "Suggest an edit" activity is a Teams event (new suggestion; status change / reply), delivered like other posts.
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ensureEvents, recordSuggestionEvent, deliverEvent, notifyStatus } from "../app/tech-board/events.ts";

function d1() {
  const sqlite = new DatabaseSync(":memory:");
  const stmt = (sql, values = []) => ({ bind: (...v) => stmt(sql, v), run: async () => sqlite.prepare(sql).run(...values),
    first: async () => sqlite.prepare(sql).get(...values) ?? null, all: async () => ({ results: sqlite.prepare(sql).all(...values) }) });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); }, sqlite };
}
const at = (s) => new Date(Date.UTC(2026, 10, 3, 17, 0, s)).toISOString();

test("new suggestion and status/reply changes each create a Teams event that posts with retry logging", async () => {
  const db = d1(); await ensureEvents(db);
  const created = await recordSuggestionEvent(db, { change: "new", id: 7, submitter: "Andrew Nelson", source: "tech", text: "Show diag done above the grid", now: at(0) });
  assert.ok(created?.id);
  const msg = db.sqlite.prepare("SELECT message FROM board_events WHERE id = ?").get(created.id).message;
  assert.match(msg, /suggestion #7 from Andrew Nelson \(tech page\): Show diag done/);
  const sent = [];
  const ok = async (_url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 202, text: async () => "" }; };
  assert.equal(await deliverEvent(db, created.id, "https://example.invalid/hook", ok, () => at(2)), true);
  assert.ok(JSON.stringify(sent[0]).includes("suggestion #7"));
  const upd = await recordSuggestionEvent(db, { change: "update", id: 7, submitter: "Andrew Nelson", source: "tech", text: "Show diag done above the grid", status: "Planned", reply: "In v1.6.5", now: at(5) });
  const m2 = db.sqlite.prepare("SELECT message FROM board_events WHERE id = ?").get(upd.id).message;
  assert.match(m2, /is now Planned · Reply: In v1\.6\.5/);
  // a failed send is logged like the other posts
  assert.equal(await deliverEvent(db, upd.id, "https://example.invalid/hook", async () => ({ ok: false, status: 429, text: async () => "throttled" }), () => at(6)), false);
  assert.equal((await notifyStatus(db, true)).recentFailures[0].status, 429);
});
