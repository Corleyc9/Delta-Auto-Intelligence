import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relative) {
  return readFile(path.join(root, relative), "utf8");
}

test("GM Overview is an action board with Verify, Needs Attention, and GP flags", async () => {
  const source = await read("app/components/views/OverviewView.tsx");
  assert.match(source, /className="action-board"/);
  assert.match(source, /Needs Attention/);
  assert.match(source, /Verify Queue/);
  assert.match(source, /GP flags/);
  assert.match(source, /Problems/);
  assert.match(source, /More metrics/);
  assert.match(source, /Ask Delta AI/);
});

test("primary nav keeps Overview Verify Board; extra screens sit under More", async () => {
  const source = await read("app/components/layout/SideRail.tsx");
  assert.match(source, /export const PRIMARY_NAV/);
  assert.match(source, /\["Overview", "Overview"\]/);
  assert.match(source, /\["Verify Queue", "Verify"\]/);
  assert.match(source, /\["Job Board", "Board"\]/);
  assert.match(source, /export const MORE_NAV/);
  assert.match(source, /Lot Walk/);
  assert.match(source, /Goal Miss/);
  assert.match(source, /aria-label="More"/);
});

test("This month sample is not offered as a live range", async () => {
  const topBar = await read("app/components/layout/TopBar.tsx");
  assert.match(topBar, /<option>Today<\/option>/);
  assert.match(topBar, /<option>This week<\/option>/);
  assert.match(topBar, /<option>Last week<\/option>/);
  assert.doesNotMatch(topBar, /<option>This month<\/option>/);
  const page = await read("app/page.tsx");
  assert.match(page, /This month/);
  assert.match(page, /This week/);
});

test("status strip stays one line and Needs Attention remains an alert", async () => {
  const source = await read("app/components/layout/StatusBanners.tsx");
  assert.match(source, /status-strip/);
  assert.match(source, /attention-banner/);
  assert.match(source, /role="alert"/);
  assert.doesNotMatch(source, /reader-revision-strip/);
  assert.doesNotMatch(source, /webhook-strip/);
});

test("Ask GM backup and Tekmetric webhook paths are unchanged", async () => {
  const topBar = await read("app/components/layout/TopBar.tsx");
  assert.match(topBar, /Ask GM backup/);
  assert.match(topBar, /grokbot:\/\/app\/v1\/sidebar\?agent=47aebd1e-10f2-46e6-a17c-d16671bd23f2/);
  const webhook = await read("app/api/webhooks/tekmetric/route.ts");
  assert.match(webhook, /handleTekmetricWebhook/);
  const tokenRoute = await read("app/api/webhooks/tekmetric/[token]/route.ts");
  assert.match(tokenRoute, /handleTekmetricWebhook/);
  const readme = await read("README.md");
  assert.match(readme, /\/api\/webhooks\/tekmetric/);
  assert.match(readme, /Ask GM backup/);
  assert.match(readme, /Do not invent a Tekmetric API/);
});

test("README documents slower cadence, overnight history, and hidden screens", async () => {
  const readme = await read("README.md");
  assert.match(readme, /8 minutes/);
  assert.match(readme, /20 minutes/);
  assert.match(readme, /60 minutes/);
  assert.match(readme, /Overnight only/);
  assert.match(readme, /under \*\*More\*\*/);
  assert.match(readme, /This month/);
  const reader = await read("reader/reader.py");
  assert.match(reader, /vehicle_history_allowed/);
  assert.match(reader, /config\.sync_minutes/);
  assert.match(reader, /config\.full_report_minutes/);
  assert.match(reader, /config\.wip_audit_minutes/);
});
