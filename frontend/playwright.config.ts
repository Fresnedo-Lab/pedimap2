// End-to-end tests in WebKit, the engine of the macOS app's webview: the
// built frontend (npm run build) against the real backend.
//
//   npx playwright install webkit     (once)
//   npm run build && npm run test:e2e
//
// Environment: E2E_PYTHON (default "python") runs the backend; it listens on
// E2E_BACKEND_PORT (default 8799). The built frontend looks for the backend at
// 8765 outside the desktop app, so every test redirects those requests to
// E2E_BACKEND_PORT: a desktop app, a dev backend or any other program on 8765
// is never touched. E2E_PORT (default 4173) serves the build, E2E_DIST another
// build instead of dist/.
//
// Both servers stop with the run, also when it fails or is interrupted
// (e2e/backend.mjs, e2e/serve.mjs, e2e/lifetime.mjs), so none is left holding
// its port.
import { defineConfig, devices } from "@playwright/test";

// Set here, before the tests read it (each falls back to 8765 on its own), and
// passed on to the test workers.
process.env.E2E_BACKEND_PORT ??= "8799";
const backendPort = Number(process.env.E2E_BACKEND_PORT);
const appPort = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "e2e",
  timeout: 300_000,
  fullyParallel: false,
  workers: 1,                      // the tests share one backend's loaded dataset
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    acceptDownloads: true,
    viewport: { width: 1400, height: 900 },
  },
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1400, height: 900 } } }],
  webServer: [
    {
      command: "node e2e/backend.mjs",
      url: `http://127.0.0.1:${backendPort}/api/health`,
      reuseExistingServer: false,  // never test against a running desktop app's backend
      timeout: 60_000,
    },
    {
      command: "node e2e/serve.mjs",
      url: `http://127.0.0.1:${appPort}/`,
      reuseExistingServer: false,
    },
  ],
});
