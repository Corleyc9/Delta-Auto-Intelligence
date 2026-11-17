// v1.6.17: Identifix lookup requests queued from the RO, claimed + answered by the assistant over the bot API.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { newIdentifixRequest, parseIdentifixResult, webhookBody, requestStatusText, latestByRo, splitVehicle, IDENTIFIX_RESULTS_LABEL } from "../app/tech-board/identifix.ts";
import { notifyIdentifixWebhook } from "../app/tech-board/identifix-notify.ts";

import { IDENTIFIX_REQUESTS_SQL, addIdentifixRequest, claimIdentifixRequest, finishIdentifixRequest, loadIdentifixRequests } from "../app/tech-board/identifix-store.ts";

function d1() {
  const sqlite = new DatabaseSync(":memory:");
  const stmt = (sql, values = []) => ({ bind: (...v) => stmt(sql, v), run: async () => sqlite.prepare(sql).run(...values),
    first: async () => sqlite.prepare(sql).get(...values) ?? null, all: async () => ({ results: sqlite.prepare(sql).all(...values) }) });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } };
}
const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("request validation: RO + codes or symptom; vehicle fields kept", () => {
  const ok = newIdentifixRequest({ ro: "RO#38589", customer: "Tim Davis", codes: "p0301 junk", symptom: "", vehicle: { ...splitVehicle("2012 GMC Sierra 1500"), engine: "5.3L", vin: "1gtr1ve05cz123456" } });
  assert.equal(ok.ro, "38589"); assert.deepEqual(ok.codes, ["P0301"]);
  assert.deepEqual([ok.vehicle.year, ok.vehicle.make, ok.vehicle.model, ok.vehicle.engine, ok.vehicle.vin], ["2012", "GMC", "Sierra 1500", "5.3L", "1GTR1VE05CZ123456"]);
  assert.equal(ok.vehicle.text, "2012 GMC Sierra 1500 5.3L");
  assert.ok("error" in newIdentifixRequest({ codes: ["P0301"] }));
  assert.ok("error" in newIdentifixRequest({ ro: "1", codes: [] }));
  assert.equal(newIdentifixRequest({ ro: "38307", symptom: "no communication with ECM" }).symptom, "no communication with ECM");
});

test("result parsing: fixes sorted by count, steps, TSBs, default source; empty rejected", () => {
  const r = parseIdentifixResult({ confirmedFixes: [{ fix: "Replaced coil", count: 12 }, { fix: "Replaced spark plug", count: "78", note: "oil fouled" }, { fix: "" }],
    testSteps: ["Pull plug, check for oil/crack", ""], tsbs: [{ id: "PIP5133", title: "Misfire" }] });
  assert.deepEqual(r.confirmedFixes.map((f) => [f.fix, f.count]), [["Replaced spark plug", 78], ["Replaced coil", 12]]);
  assert.deepEqual(r.testSteps, ["Pull plug, check for oil/crack"]); assert.equal(r.source, "Identifix Direct-Hit");
  assert.ok("error" in parseIdentifixResult({}));
});

test("store lifecycle: queued → in-progress (single claim) → done / failed", async () => {
  const db = d1(); await db.prepare(IDENTIFIX_REQUESTS_SQL).run();
  assert.ok(src("../app/tech-board/store.ts").includes("IDENTIFIX_REQUESTS_SQL,"));
  const req = newIdentifixRequest({ ro: "38589", codes: ["P0301"], vehicle: "2012 GMC Sierra 1500" });
  const id = await addIdentifixRequest(db, req, "Devin", "2026-11-04T17:00:00.000Z");
  assert.equal((await loadIdentifixRequests(db, "queued")).length, 1);
  const claimed = await claimIdentifixRequest(db, id, "Teams bot", "2026-11-04T17:01:00.000Z");
  assert.equal(claimed.status, "in-progress");
  assert.equal(await claimIdentifixRequest(db, id, "other", "2026-11-04T17:02:00.000Z"), null);
  assert.equal((await loadIdentifixRequests(db, "queued")).length, 0);
  const done = await finishIdentifixRequest(db, id, { result: parseIdentifixResult({ confirmedFixes: [{ fix: "Plug", count: 78 }] }) }, "2026-11-04T17:05:00.000Z");
  assert.equal(done.status, "done"); assert.equal(done.result.confirmedFixes[0].count, 78);
  assert.equal(requestStatusText(done), "Identifix results ready");
  const id2 = await addIdentifixRequest(db, req, "Devin", "2026-11-04T17:06:00.000Z");
  const failed = await finishIdentifixRequest(db, id2, { failReason: "No vehicle match" }, "2026-11-04T17:07:00.000Z");
  assert.equal(failed.status, "failed"); assert.match(requestStatusText(failed), /No vehicle match/);
  assert.equal(latestByRo(await loadIdentifixRequests(db)).get("38589").id, id2);
  assert.match(requestStatusText({ status: "queued" }), /^Identifix lookup requested…/);
});

test("webhook: unset → no call; set → POST {id, ro, codes, vehicle}; failure never throws", async () => {
  const payload = webhookBody({ id: 7, ro: "38589", codes: ["P0301"], vehicle: { text: "2012 GMC Sierra" }, customer: "x" });
  assert.deepEqual(Object.keys(payload), ["id", "ro", "codes", "vehicle"]);
  let calls = [];
  assert.equal(await notifyIdentifixWebhook(payload, async (...a) => { calls.push(a); return { ok: true }; }, ""), false);
  assert.equal(calls.length, 0);
  assert.equal(await notifyIdentifixWebhook(payload, async (...a) => { calls.push(a); return { ok: true }; }, "https://hook.example/x"), true);
  assert.equal(calls[0][1].method, "POST"); assert.deepEqual(JSON.parse(calls[0][1].body), payload);
  assert.equal(await notifyIdentifixWebhook(payload, async () => { throw new Error("down"); }, "https://hook.example/x"), false);
});

test("wiring: bot actions, writer action, tech gating, label", () => {
  const bot = src("../app/api/tech-board/bot/route.ts");
  for (const a of ["list-identifix-requests", "claim-identifix-request", "post-identifix-result", "fail-identifix-request"]) assert.ok(bot.includes(`"${a}"`));
  assert.ok(src("../app/tech-board/actions.ts").includes('"identifix-request"'));
  const tech = src("../app/api/tech/route.ts");
  assert.ok(tech.includes('String(env.IDENTIFIX_RESULTS_FOR_TECHS ?? "") === "1"'));
  assert.ok(tech.includes("identifixResults ? (await loadIdentifixRequests(db))"));
  assert.ok(!src("../app/tech-board/TechPage.tsx").includes("IdentifixRequestBox"), "techs can't queue lookups");
  assert.equal(IDENTIFIX_RESULTS_LABEL, "Check-in scan — Identifix known fixes (triage, not a diagnosis)");
  assert.match(src("../app/lib/version.ts"), /"v1\.6\.(1[7-9]|[2-9]\d)"/);
});
