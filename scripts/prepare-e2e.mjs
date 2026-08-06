/** Prepare a disposable local Cloudflare state directory for browser tests. */
import { copyFile, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerRoot = resolve(repositoryRoot, "apps/worker");
const statePath = resolve(workerRoot, ".wrangler/e2e");
if (!statePath.endsWith("/apps/worker/.wrangler/e2e")) {
  throw new Error(`Refusing to reset unexpected E2E state path: ${statePath}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      CI: "true",
      WRANGLER_SEND_METRICS: "false",
      XDG_CONFIG_HOME: "/tmp/ace-omni-xdg-e2e",
    },
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
}

await rm(statePath, { recursive: true, force: true });
await mkdir(statePath, { recursive: true });
const devVarsPath = resolve(workerRoot, ".dev.vars");
if (process.env.CI === "true") {
  await copyFile(resolve(workerRoot, ".dev.vars.example"), devVarsPath);
}

run("npm", ["run", "build", "--workspace=apps/web"]);
run(resolve(repositoryRoot, "node_modules/.bin/wrangler"), [
  "d1", "migrations", "apply", "ace-omni-db",
  "--config", resolve(workerRoot, "wrangler.jsonc"),
  "--local", "--persist-to", statePath,
]);
run("npm", [
  "run", "seed:local", "--workspace=apps/worker", "--", "--persist-to", statePath,
]);
