// v1.6.14: techs don't see front office on /tech (writer board unchanged).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { hiddenFromTech } from "../app/tech-board/scheduler.ts";

test("6–7 AM row and front-office-parked blocks are hidden; 7–8 appointments, yellow and regular work stay", () => {
  assert.equal(hiddenFromTech({ status: "front-office", startMinute: -120 }), true);
  assert.equal(hiddenFromTech({ status: "ready", startMinute: -120 }), true, "anything in the 6–7 row");
  assert.equal(hiddenFromTech({ status: "front-office", startMinute: -60 }), true, "front office parked in 7–8");
  assert.equal(hiddenFromTech({ status: "ready", startMinute: -60, apptKey: "a|u" }), false, "7–8 AM Tekmetric appointment");
  assert.equal(hiddenFromTech({ status: "custom", startMinute: -120, apptKey: "Y|1" }), false, "yellow customer appointment");
  assert.equal(hiddenFromTech({ status: "diag", startMinute: 0 }), false);
});

test("tech API and page filter; writer board does not", () => {
  const route = readFileSync(new URL("../app/api/tech/route.ts", import.meta.url), "utf8");
  assert.ok(route.includes("!job.hidden && !hiddenFromTech(job)") && route.includes("!hiddenFromTech(item)"));
  assert.ok(readFileSync(new URL("../app/tech-board/TechPage.tsx", import.meta.url), "utf8").includes("filter((job) => !hiddenFromTech(job))"));
  assert.ok(!readFileSync(new URL("../app/tech-board/TechBoardPanel.tsx", import.meta.url), "utf8").includes("hiddenFromTech"));
});
