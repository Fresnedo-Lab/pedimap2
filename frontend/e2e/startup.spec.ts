// A slow backend start, as in the desktop app, in WebKit: in the dev
// configuration (Vite's dev server, as `npm run app:dev`; project
// "webkit-dev") and in the production build release apps embed (project
// "webkit"). A stand-in for the Tauri shell hands the page a backend on a
// free port, not 8765, and reports it running; the backend itself starts
// only after the 15 s mark, as the PyInstaller sidecar can on a busy machine
// (it measured 9–12 s on an idle one). The window must keep saying
// "Starting Pedimap…", never show an error, and load the data once the
// backend answers, without a single request to 8765.

import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** The backend, started late; stopped with the test (and with the run, e2e/backend.mjs). */
function startBackend(port: number): ChildProcess {
  return spawn(process.execPath, ["e2e/backend.mjs"],
    { env: { ...process.env, E2E_BACKEND_PORT: String(port) }, stdio: "ignore" });
}

test("a backend that starts after 15 s: Starting Pedimap…, then the data, never 8765", async ({ page }) => {
  test.setTimeout(120_000);
  const port = await freePort();
  expect(port).not.toBe(8765);

  // The Tauri shell, as the page sees it: isTauri(), get_backend_url and a
  // backend_report that says the backend process is running (spawned, not
  // yet listening). Every other command answers null.
  await page.addInitScript(({ port }) => {
    const url = `http://127.0.0.1:${port}`;
    Object.defineProperty(window, "isTauri", { value: true });
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
      plugins: {},
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => 0,
      unregisterCallback: () => {},
      convertFileSrc: (path: string) => path,
      invoke: async (cmd: string) => {
        if (cmd === "get_backend_url") return url;
        if (cmd === "backend_report") {
          return { port, url, running: true, spawnError: null, exitCode: null,
                   exitSignal: null, portInUse: false, stderrTail: [] };
        }
        return null;
      },
    } });
  }, { port });

  const to8765: string[] = [];
  page.on("request", r => { if (r.url().includes(":8765")) to8765.push(r.url()); });

  let backend: ChildProcess | undefined;
  try {
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText("Starting Pedimap…");
    await expect(page.getByText(/can take longer the first time/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Cannot reach/)).toHaveCount(0);

    backend = startBackend(port);                               // about 16 s after loading
    await expect(page.getByText(/Apple Breeding Program – Demo · \d+ individuals/))
      .toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/Cannot reach/)).toHaveCount(0);
    expect(to8765).toEqual([]);
  } finally {
    backend?.kill("SIGTERM");
  }
});
