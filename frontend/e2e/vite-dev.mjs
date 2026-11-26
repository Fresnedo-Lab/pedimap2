// e2e/vite-dev.mjs
// ================
// Serves the frontend with Vite's dev server, as `npm run app:dev` does, for
// the "webkit-dev" project (playwright.config.ts), on E2E_DEV_PORT, and stops
// it with the run that started it (e2e/lifetime.mjs).

import { spawn } from "node:child_process";
import { stopWithParent } from "./lifetime.mjs";

const port = process.env.E2E_DEV_PORT;
if (!port) throw new Error("E2E_DEV_PORT is not set (playwright.config.ts sets it)");

const vite = spawn(process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", port, "--strictPort"],
  { stdio: "inherit" });

const stop = stopWithParent(() => new Promise(resolve => {
  if (vite.exitCode !== null || vite.signalCode !== null) return resolve();
  vite.once("exit", resolve);
  vite.kill("SIGTERM");
  setTimeout(() => { vite.kill("SIGKILL"); resolve(); }, 3000).unref();
}));
vite.on("exit", code => stop(code ?? 0));
vite.on("error", err => { console.error(`Could not start Vite: ${err.message}`); stop(1); });
