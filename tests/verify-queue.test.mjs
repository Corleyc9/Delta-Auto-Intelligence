import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relative) {
  return readFile(path.join(root, relative), "utf8");
}

test("Verified click does not depend on window.prompt", async () => {
  const page = await read("app/page.tsx");
  const view = await read("app/components/views/VerifyQueueView.tsx");
  const markVerified = page.slice(page.indexOf("async function markVerified"), page.indexOf("useEffect", page.indexOf("async function markVerified")));
  assert.match(markVerified, /fetch\("\/api\/verifications"/);
  assert.match(markVerified, /method: "PATCH"/);
  assert.doesNotMatch(markVerified, /window\.prompt/);
  assert.doesNotMatch(markVerified, /note === undefined/);
  assert.match(page, /markVerified,/);
  assert.match(view, /onClick=\{\(\) => markVerified\(item, notes\[item\.id\] \?\? ""\)\}/);
  assert.match(view, /className="verify-note-field"/);
  assert.match(view, /Leave blank if none/);
});

test("PATCH /api/verifications still records history with an optional note", async () => {
  const route = await read("app/api/verifications/route.ts");
  assert.match(route, /requireApiUser/);
  assert.match(route, /status = 'verified'/);
  assert.match(route, /verification_note/);
  assert.match(route, /String\(body\.note \|\| ""\)\.trim\(\)/);
  assert.match(route, /WHERE id = \? AND status = 'pending'/);
});
