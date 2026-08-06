/**
 * ACE Omni tracked-source integrity guard.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "buffer" })
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

let failed = false;
for (const file of files) {
  const buf = readFileSync(file);
  if (buf.includes(0)) {
    console.error(`NUL byte in tracked file: ${file}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`Checked ${files.length} tracked files; no NUL corruption.`);
