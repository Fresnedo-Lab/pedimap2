// End-to-end tests in WebKit, the engine of the macOS app's webview: the
// built frontend (npm run build) against the real backend.
//
//   npx playwright install webkit     (once)
//   npm run build && npm run test:e2e
//
// Environment: E2E_PYTHON (default "python") runs the backend; it listens on
// E2E_BACKEND_PORT (default 8765, where the app looks for it; another port
// is redirected to, e.g. while the desktop app holds 8765). E2E_DIST serves
// another build instead of dist/.
import { defineConfig, devices } from "@playwright/test";

const backendPort = Number(process.env.E2E_BACKEND_PORT ?? 8765);
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
      command: `${process.env.E2E_PYTHON ?? "python"} -m uvicorn api:app --app-dir ../backend ` +
               `--host 127.0.0.1 --port ${backendPort}`,
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
