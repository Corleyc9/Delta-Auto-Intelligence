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

test("job names stay on the card and Bay Scan is not on that row", () => {
  const panel = src("../app/tech-board/TechBoardPanel.tsx");
  const css = src("../app/globals.css");
  assert.equal((panel.match(/<RequestedJobRow /g) || []).length, 2, "tech lanes / unassigned and front office");
  assert.match(panel, /tb-card-jobline/);
  assert.equal(panel.includes("<CardBayScan "), false);
  assert.equal(panel.includes("bayscan-card-button"), false);
  assert.match(panel, /data-testid="bayscan-board-button"/);
  assert.match(panel, /tb-card-title">\{job\.custom \? jobTitle\(job\) : roTitle/);
  const vehicleAt = panel.indexOf('className="tb-card-vehicle"');
  const jobsAt = panel.lastIndexOf("<RequestedJobRow ");
  const quickAt = panel.indexOf('className="tb-quick"');
  assert.ok(vehicleAt > 0 && quickAt > vehicleAt && jobsAt > quickAt, "on the schedule card the job names stay below the vehicle line and the percent buttons");
  assert.match(css, /\.tb-card-jobs \{[^}]*margin-top:\s*auto/);
  assert.match(APP_VERSION, /^v1\.6\.2[5-9]$/);
});
