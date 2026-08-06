import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: fileURLToPath(new URL("./wrangler.test.jsonc", import.meta.url)),
      },
      miniflare: {
        bindings: {
          SESSION_SECRET: "test-session-secret-with-at-least-thirty-two-bytes",
          TOKEN_SIGNING_SECRET: "test-token-signing-secret-with-at-least-thirty-two-bytes",
          SCHEDULE_SIGNING_SECRET: "test-schedule-secret-with-at-least-thirty-two-bytes",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    provide: { migrations },
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});

declare module "vitest" {
  export interface ProvidedContext {
    migrations: import("@cloudflare/vitest-pool-workers").D1Migration[];
  }
}
