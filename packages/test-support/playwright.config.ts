import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : [["line"], ["html", { open: "never" }]],
  outputDir: "../../test-results/playwright",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:8787",
    permissions: ["camera", "microphone"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
        "--allow-loopback-in-peer-connection",
        "--disable-features=WebRtcHideLocalIpsWithMdns",
      ],
    },
  },
  webServer: {
    command: "npm run dev:e2e --workspace=apps/worker",
    cwd: "../..",
    url: "http://127.0.0.1:8787/api/health",
    timeout: 60_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
