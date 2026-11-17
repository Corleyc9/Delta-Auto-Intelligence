// v1.6.15 preview: DTC → Identifix and check-in scan codes; off for techs unless IDENTIFIX_FOR_TECHS = "1".
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizeDtcs, dtcClipboardText, checkinRo, IDENTIFIX_URL, CHECKIN_LABEL } from "../app/tech-board/dtc.ts";
import { botToBoardAction } from "../app/lib/bot-auth.ts";

test("DTC parsing and the clipboard text", () => {
  assert.deepEqual(normalizeDtcs("p0300, P0171  u0100 junk P030 P0300"), ["P0300", "P0171", "U0100"]);
  assert.deepEqual(normalizeDtcs(["b1234", "C0035"]), ["B1234", "C0035"]);
  assert.equal(dtcClipboardText(["P0300"], "2018 Chevrolet Silverado 1500"), "P0300 · 2018 Chevrolet Silverado 1500");
  assert.equal(IDENTIFIX_URL, "https://dh.identifix.com/");
  assert.equal(checkinRo({ ro: "38528-J2~2", roNumber: "38528" }), "38528");
  assert.equal(checkinRo({ ro: "C-x", custom: true, linkedRo: "38504" }), "38504");
  assert.match(CHECKIN_LABEL, /triage only — not a diagnosis; sell diag, no parts from codes/);
});

test("bot set-checkin maps to checkin-set", () => {
  assert.deepEqual(botToBoardAction({ action: "set-checkin", ro: "RO#38589", codes: ["P0300"], notes: "FF: 1200 rpm" }),
    { action: "checkin-set", ro: "38589", codes: ["P0300"], notes: "FF: 1200 rpm" });
  assert.ok("error" in botToBoardAction({ action: "set-checkin" }));
});

test("tech view is gated by IDENTIFIX_FOR_TECHS; writer drawer always has it", () => {
  const route = readFileSync(new URL("../app/api/tech/route.ts", import.meta.url), "utf8");
  assert.ok(route.includes('String(env.IDENTIFIX_FOR_TECHS ?? "") === "1"'));
  assert.ok(route.includes("identifix ? (await loadCheckins(db)).filter((item) => myRos.has(item.ro)) : []"));
  const page = readFileSync(new URL("../app/tech-board/TechPage.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("{identifix && <CheckinList") && page.includes("{identifix && !(checkin?.codes.length) && <DtcBox"));
  assert.ok(!page.includes("CheckinEditor"), "techs can't edit check-in codes");
  const panel = readFileSync(new URL("../app/tech-board/TechBoardPanel.tsx", import.meta.url), "utf8");
  assert.ok(panel.includes("<CheckinEditor"));
  const actions = readFileSync(new URL("../app/tech-board/actions.ts", import.meta.url), "utf8");
  assert.ok(actions.includes('"checkin-set"'));
});
