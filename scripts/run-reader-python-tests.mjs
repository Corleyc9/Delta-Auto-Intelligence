#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync(
  "python3",
  ["-m", "unittest", "discover", "-s", "reader/tests", "-p", "test_*.py"],
  { encoding: "utf8" },
);

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const missingPython =
  result.error?.code === "ENOENT"
  || /unknown command:\s*python3/i.test(output)
  || /reshim/i.test(output);

if (missingPython) {
  console.log(
    "Skipping reader Python tests: python3 is not available. Cloudflare Workers builds pack the reader ZIP with Node and do not run these parser fixtures.",
  );
  process.exit(0);
}

if (output) process.stdout.write(output);
process.exit(result.status ?? 1);
