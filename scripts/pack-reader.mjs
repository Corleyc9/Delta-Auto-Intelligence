#!/usr/bin/env node
/**
 * Rebuild public/downloads/delta-auto-reader.zip from the current reader sources.
 * Uses Node only so Cloudflare Workers builds (no python3) can pack a ZIP whose
 * 12-character hash matches reader/build-hash.json and public/reader-version.json.
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const HASH_SUFFIXES = new Set([".py", ".txt", ".ps1", ".json"]);
const HASH_SKIP_NAMES = new Set(["VERSION", "build-hash.json"]);
const SKIP_DIR_NAMES = new Set(["__pycache__", "tests"]);

const ZIP_FIXED_FILES = [
  "reader.py",
  "config.py",
  "numeric.py",
  "version.py",
  "requirements.txt",
  "build-hash.json",
  "VERSION",
  "install-reader.ps1",
  "register-scheduled-task.ps1",
];

const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

export function repoRootFrom(dir = path.dirname(fileURLToPath(import.meta.url))) {
  return path.resolve(dir, "..");
}

export async function readReaderVersion(readerDir) {
  const source = await readFile(path.join(readerDir, "version.py"), "utf8");
  const match = source.match(/^READER_VERSION\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error("Could not parse READER_VERSION from reader/version.py");
  }
  return match[1];
}

function toPosix(relative) {
  return relative.split(path.sep).join("/");
}

async function collectFiles(dir, relative, predicate, out) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      await collectFiles(full, rel, predicate, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const parts = rel.split("/");
    if (parts.some((part) => SKIP_DIR_NAMES.has(part))) continue;
    if (predicate(entry.name, rel)) out.push(rel);
  }
}

export async function hashReaderSources(readerDir) {
  const files = [];
  await collectFiles(
    readerDir,
    "",
    (name) => HASH_SUFFIXES.has(path.extname(name)) && !HASH_SKIP_NAMES.has(name),
    files,
  );
  files.sort();
  const digest = createHash("sha256");
  for (const relative of files) {
    digest.update(path.posix.basename(relative), "utf8");
    digest.update(Buffer.from([0]));
    digest.update(await readFile(path.join(readerDir, ...relative.split("/"))));
    digest.update(Buffer.from([0]));
  }
  return digest.digest("hex").slice(0, 12);
}

async function zipIncludeList(readerDir) {
  const include = [...ZIP_FIXED_FILES];
  const parsers = [];
  const parsersDir = path.join(readerDir, "parsers");
  try {
    await access(parsersDir);
  } catch {
    throw new Error("Missing reader/parsers directory");
  }
  await collectFiles(parsersDir, "parsers", () => true, parsers);
  parsers.sort();
  include.push(...parsers);
  return include;
}

function localFileRecord(name, uncompressed) {
  const nameBuf = Buffer.from(name, "utf8");
  const compressed = deflateRawSync(uncompressed, { level: -1 });
  const crc = crc32(uncompressed) >>> 0;
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(uncompressed.length, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  header.writeUInt16LE(0, 28);
  return {
    name,
    nameBuf,
    uncompressed,
    compressed,
    crc,
    local: Buffer.concat([header, nameBuf, compressed]),
  };
}

function centralDirectoryRecord(entry, localOffset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20 | (3 << 8), 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressed.length, 20);
  header.writeUInt32LE(entry.uncompressed.length, 24);
  header.writeUInt16LE(entry.nameBuf.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localOffset, 42);
  return Buffer.concat([header, entry.nameBuf]);
}

export function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const entry = localFileRecord(file.name, file.data);
    locals.push(entry.local);
    centrals.push(centralDirectoryRecord(entry, offset));
    offset += entry.local.length;
  }
  const localBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

export function readZip(buffer) {
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) {
    throw new Error("Invalid ZIP: missing end of central directory");
  }
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const names = [];
  const files = new Map();
  let pos = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error("Invalid ZIP: missing central directory header");
    }
    const compression = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (compression === 0) data = Buffer.from(compressed);
    else if (compression === 8) data = inflateRawSync(compressed);
    else throw new Error(`Unsupported ZIP compression ${compression} for ${name}`);
    names.push(name);
    files.set(name, data);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return { names, files };
}

export async function packReader({ root = repoRootFrom() } = {}) {
  const readerDir = path.join(root, "reader");
  const publicDir = path.join(root, "public");
  const zipPath = path.join(publicDir, "downloads", "delta-auto-reader.zip");

  const version = await readReaderVersion(readerDir);
  const buildHash = await hashReaderSources(readerDir);
  const revision = { version, buildHash };
  const revisionJson = `${JSON.stringify(revision, null, 2)}\n`;
  const versionText = `${version}+${buildHash}\n`;

  await writeFile(path.join(readerDir, "build-hash.json"), revisionJson, "utf8");
  await writeFile(path.join(readerDir, "VERSION"), versionText, "utf8");
  await writeFile(path.join(publicDir, "reader-version.json"), revisionJson, "utf8");

  const include = await zipIncludeList(readerDir);
  const zipFiles = [];
  for (const relative of include) {
    const posix = toPosix(relative);
    const source = path.join(readerDir, ...posix.split("/"));
    try {
      await access(source);
    } catch {
      throw new Error(`Missing reader file for ZIP: ${posix}`);
    }
    zipFiles.push({ name: posix, data: await readFile(source) });
  }

  const zipBuffer = buildZip(zipFiles);
  await mkdir(path.dirname(zipPath), { recursive: true });
  await pipeline(Readable.from(zipBuffer), createWriteStream(zipPath));

  const zipHash = createHash("sha256").update(zipBuffer).digest("hex").slice(0, 12);
  console.log(`Packed reader ${version}+${buildHash}`);
  console.log(`ZIP ${zipPath} sha256=${zipHash}`);
  return { version, buildHash, zipPath, zipHash };
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (invokedDirectly()) {
  packReader().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
