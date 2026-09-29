import { defineConfig, devices } from "@playwright/test";

const mode = process.env.E2E_MODE || "local";
const local = mode === "local";
const oauth = mode === "oauth";
const baseURL = process.env.BETTER_AUTH_URL || "http://localhost:3210";

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: local ? "**/*.spec.ts" : `*.${mode}.spec.ts`,
  testIgnore: local ? ["*.live.spec.ts", "*.oauth.spec.ts"] : [],
  workers: 1,
  retries: 0,
  timeout: local ? 45_000 : oauth ? 90_000 : 180_000,
  expect: { timeout: local ? 15_000 : 30_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: `playwright-report/${mode}` }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    extraHTTPHeaders: { Origin: baseURL },
    // The OAuth suite attaches to a personal browser; never capture its other tabs.
    trace: oauth ? "off" : "retain-on-failure",
    screenshot: oauth ? "off" : "only-on-failure",
  },
  webServer: {
    command: local
      ? "node test/serve.mjs"
      : "node --import ./test/live-budget.mjs .output/server/index.mjs",
    url: baseURL,
    env: { PORT: new URL(baseURL).port, HOST: "127.0.0.1" },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
