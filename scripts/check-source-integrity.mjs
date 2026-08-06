/**
 * ACE Omni tracked-source integrity guard.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SOURCE_EXTENSIONS = new Set([
  ".cjs", ".css", ".cts", ".html", ".js", ".json", ".jsonc", ".jsx",
  ".md", ".mjs", ".mts", ".sql", ".toml", ".ts", ".tsx", ".txt",
  ".yaml", ".yml",
]);

const sourceFiles = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"])
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

const failures = [];
for (const file of sourceFiles) {
  const dot = file.lastIndexOf(".");
  const extension = dot === -1 ? "" : file.slice(dot).toLowerCase();
  if (!SOURCE_EXTENSIONS.has(extension)) continue;

  const bytes = readFileSync(file);
  if (bytes.includes(0)) failures.push(`${file}: contains a NUL byte`);
  if (bytes.length > 0 && bytes.every((byte) => byte === 0)) {
    failures.push(`${file}: contains only NUL bytes`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`Tracked source integrity check failed:\n${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Source integrity check passed (${sourceFiles.length} tracked or pending files scanned).\n`);
}
