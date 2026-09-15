import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, symlinkSync, lstatSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  hashReaderSources,
  readZip,
} from "../scripts/pack-reader.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function pathWithoutPython(envPath = process.env.PATH ?? "") {
  const staging = mkdtempSync(path.join(os.tmpdir(), "nopy-path-"));
  const seen = new Set();
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (/^python(\d.*)?$/i.test(name) || seen.has(name)) continue;
      const source = path.join(dir, name);
      try {
        const stat = lstatSync(source);
        if (!stat.isFile() && !stat.isSymbolicLink()) continue;
        symlinkSync(source, path.join(staging, name));
        seen.add(name);
      } catch {
        // skip colliding or unreadable entries
      }
    }
  }
  return staging;
}

test("wrangler.toml targets Worker delta-auto-intelligence with DB and BUCKET", async () => {
  const toml = await readFile(path.join(root, "wrangler.toml"), "utf8");
  assert.match(toml, /^name\s*=\s*"delta-auto-intelligence"/m);
  assert.match(toml, /binding\s*=\s*"DB"/);
  assert.match(toml, /database_name\s*=\s*"delta-auto-intelligence"/);
  assert.match(toml, /binding\s*=\s*"BUCKET"/);
  assert.match(toml, /bucket_name\s*=\s*"delta-auto-lot-walks"/);
  assert.match(toml, /delta_auto_lot_walks/);
});

test("pack:reader succeeds when python3 is not on PATH and keeps hashes aligned", async () => {
  const strippedPath = pathWithoutPython();
  const env = { ...process.env, PATH: strippedPath };
  const pythonCheck = spawnSync("python3", ["-V"], { env, encoding: "utf8" });
  assert.ok(
    pythonCheck.error?.code === "ENOENT" || pythonCheck.status !== 0,
    "PATH still resolves python3; cannot simulate a Cloudflare build image",
  );

  const packed = spawnSync("npm", ["run", "pack:reader"], { cwd: root, env, encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  assert.match(packed.stdout, /Packed reader 2\.0\.0\+[a-f0-9]{12}/);

  const readerDir = path.join(root, "reader");
  const buildHash = await hashReaderSources(readerDir);
  const packaged = JSON.parse(await readFile(path.join(readerDir, "build-hash.json"), "utf8"));
  const publicRevision = JSON.parse(
    await readFile(path.join(root, "public/reader-version.json"), "utf8"),
  );
  assert.equal(buildHash, packaged.buildHash);
  assert.equal(buildHash, publicRevision.buildHash);
  assert.equal(packaged.version, publicRevision.version);

  const zipPath = path.join(root, "public/downloads/delta-auto-reader.zip");
  const zip = readZip(await readFile(zipPath));
  const names = zip.names.join("\n");
  assert.match(names, /reader\.py/);
  assert.match(names, /parsers\/job_board\.py/);
  assert.match(names, /install-reader\.ps1/);
  assert.doesNotMatch(names, /tests\//);
  assert.equal(
    zip.files.get("build-hash.json").toString("utf8"),
    `${JSON.stringify({ version: packaged.version, buildHash }, null, 2)}\n`,
  );
  assert.equal(
    zip.files.get("VERSION").toString("utf8").trim(),
    `${packaged.version}+${buildHash}`,
  );
});
