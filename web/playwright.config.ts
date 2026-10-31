import { defineConfig } from "@playwright/test";
import fs from "node:fs";

// Load DATABASE_URL etc. for the global setup/teardown cleanup (local DB only).
if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

// E2E_PORT / E2E_DIST_DIR let several suites run side by side (own server and build dir).
const PORT = Number(process.env.E2E_PORT) || 3130;
const DIST_DIR = process.env.E2E_DIST_DIR || ".next-e2e";
const headed = process.env.HEADED === "1";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  // One shared dev server and ordered sign-up -> listing -> quote flows.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  reporter: [["list"], ["json", { outputFile: "playwright-report/results.json" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: !headed,
    launchOptions: headed ? { slowMo: 250 } : {},
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 90_000,
  },
  projects: [
    {
      name: "mobile-390",
      use: { browserName: "chromium", viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 1 },
    },
    {
      name: "desktop-1440",
      use: { browserName: "chromium", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    env: { NEXT_DIST_DIR: DIST_DIR },
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
