// e2e/backend.mjs
// ===============
// Starts the backend for the WebKit tests and the manual's screenshots
// (playwright.config.ts), on E2E_BACKEND_PORT, and stops it with the run that
// started it (e2e/lifetime.mjs), so it never outlives the run.
//
// E2E_PYTHON (default "python") runs it.

import { spawn } from "node:child_process";
import { stopWithParent } from "./lifetime.mjs";

const python = process.env.E2E_PYTHON ?? "python";
const port = process.env.E2E_BACKEND_PORT;
if (!port) throw new Error("E2E_BACKEND_PORT is not set (playwright.config.ts sets it)");

const backend = spawn(python,
  ["-m", "uvicorn", "api:app", "--app-dir", "../backend", "--host", "127.0.0.1", "--port", port],
  { stdio: "inherit" });

const stop = stopWithParent(() => new Promise(resolve => {
  if (backend.exitCode !== null || backend.signalCode !== null) return resolve();
  backend.once("exit", resolve);
  backend.kill("SIGTERM");
  setTimeout(() => { backend.kill("SIGKILL"); resolve(); }, 3000).unref();
}));
backend.on("exit", code => stop(code ?? 0));
backend.on("error", err => { console.error(`Could not start the backend with ${python}: ${err.message}`); stop(1); });
