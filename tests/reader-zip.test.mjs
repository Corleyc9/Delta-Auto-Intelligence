import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readZip } from "../scripts/pack-reader.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relative) {
  return JSON.parse(await readFile(path.join(root, relative), "utf8"));
}

test("packaged reader hash matches dashboard JSON and ZIP contents", async () => {
  const zipPath = path.join(root, "public/downloads/delta-auto-reader.zip");
  await access(zipPath, constants.R_OK);
  const publicRevision = await readJson("public/reader-version.json");
  const packaged = await readJson("reader/build-hash.json");
  assert.equal(publicRevision.buildHash, packaged.buildHash);
  assert.equal(publicRevision.version, packaged.version);
  assert.match(packaged.buildHash, /^[a-f0-9]{12}$/);

  const zip = readZip(await readFile(zipPath));
  const names = zip.names.join("\n");
  assert.match(names, /reader\.py/);
  assert.match(names, /parsers\/job_board\.py/);
  assert.match(names, /install-reader\.ps1/);
  assert.doesNotMatch(names, /tests\//);
  const hashJson = zip.files.get("build-hash.json").toString("utf8");
  const versionText = zip.files.get("VERSION").toString("utf8").trim();
  assert.match(hashJson, new RegExp(packaged.buildHash));
  assert.equal(versionText, `${packaged.version}+${packaged.buildHash}`);
});
