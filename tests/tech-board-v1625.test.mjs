// v1.6.25: Bay Scan sits on the requested-job row at the bottom of each RO card.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { APP_VERSION } from "../app/lib/version.ts";
import { requestedJobLines } from "../app/tech-board/dtc.ts";

const src = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("merged job names split into the lines shown beside Bay Scan", () => {
  assert.deepEqual(requestedJobLines("Oil + Brakes + Wipers"), ["Oil", "Brakes", "Wipers"]);
  assert.deepEqual(requestedJobLines("  Brake pads  "), ["Brake pads"]);
  assert.deepEqual(requestedJobLines(""), []);
  assert.deepEqual(requestedJobLines(null), []);
});

test("the Bay Scan button sits on the requested-job row, not under the vehicle line", () => {
  const panel = src("../app/tech-board/TechBoardPanel.tsx");
  const css = src("../app/globals.css");
  const drawer = src("../app/tech-board/DtcBox.tsx");
  assert.equal((panel.match(/<RequestedJobRow /g) || []).length, 2, "tech lanes / unassigned and front office");
  assert.equal((panel.match(/data-testid="bayscan-card-jobs"/g) || []).length, 1, "one shared row used by every card");
  assert.match(panel, /tb-card-jobline/);
  assert.match(panel, /<CardBayScan /);
  assert.match(panel, /event\.stopPropagation\(\)/);
  assert.match(panel, /action: "bayscan-scan-request"/);
  assert.match(panel, /tb-card-title">\{job\.custom \? jobTitle\(job\) : roTitle/);
  const vehicleAt = panel.indexOf('className="tb-card-vehicle"');
  const jobsAt = panel.lastIndexOf("<RequestedJobRow ");
  const quickAt = panel.indexOf('className="tb-quick"');
  assert.ok(vehicleAt > 0 && quickAt > vehicleAt && jobsAt > quickAt, "on the schedule card the job row is below the vehicle line and the percent buttons");
  assert.match(css, /\.tb-card-jobs \{[^}]*margin-top:\s*auto/);
  assert.match(css, /touch-action:\s*manipulation/);
  assert.match(css, /min-height:\s*32px/);
  assert.match(drawer, /data-testid="bayscan-request-button"/);
  assert.match(src("../README.md"), /requested-job row/);
  assert.equal(APP_VERSION, "v1.6.25");
});
