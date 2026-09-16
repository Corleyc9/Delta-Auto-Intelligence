import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GM_BACKUP_URL =
  "grokbot://app/v1/sidebar?agent=47aebd1e-10f2-46e6-a17c-d16671bd23f2";

test("authenticated top bar links to the GM backup Grok Bot chat", async () => {
  const source = await readFile(path.join(root, "app/components/layout/TopBar.tsx"), "utf8");
  assert.match(source, /Ask GM backup/);
  assert.match(source, new RegExp(GM_BACKUP_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /Opens Grok Bot to your shop GM backup chat \(app must be installed\)\./);
  assert.match(source, /className="gm-backup-button"/);
  assert.match(source, /className="signout-button"/);
  assert.match(source, /onOpenReader/);
});

test("README notes that the Grok Bot app is required", async () => {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  assert.match(readme, /Ask GM backup/);
  assert.match(readme, /Grok Bot (desktop )?app must be installed/i);
});
