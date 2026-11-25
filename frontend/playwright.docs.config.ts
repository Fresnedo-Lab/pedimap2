// Screenshots for the user manual (docs/), taken in WebKit from the built
// frontend (npm run build) against the real backend, like the end-to-end
// tests. Run with `npm run docs:screenshots`; the PNGs go to docs/images/.
//
// Only Example.dat, apple_public.dat and the FlexQTL fixture are used.
import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testDir: "docs-screenshots",
  outputDir: "test-results/docs-screenshots",
  reporter: "list",
  projects: [{
    name: "webkit",
    use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
  }],
});
