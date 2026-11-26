// The desktop app reaches its backend only at the URL the Rust shell gives
// (a free port, never a fixed fallback), accepts only a health reply that
// identifies Pedimap's backend, and explains failures in plain words.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

const tauri = vi.hoisted(() => ({ desktop: true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => tauri.desktop,
  invoke: tauri.invoke,
}));

import {
  HEALTH_ATTEMPT_MS, HEALTH_INTERVAL_MS, HEALTH_SLOW_MS, HEALTH_TIMEOUT_MS, REINSTALL_HINT, explainBackendFailure, forgetBackendUrl,
  isPedimapHealth, useBackendHealth, type BackendReport,
} from "./useApi";

const report = (r: Partial<BackendReport>): BackendReport => ({
  port: 54321, url: "http://127.0.0.1:54321", running: true, spawnError: null,
  exitCode: null, exitSignal: null, portInUse: false, stderrTail: [], ...r,
});

function serveHealth(body: unknown) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); tauri.invoke.mockReset(); forgetBackendUrl(); });

describe("the desktop app's backend", () => {
  it("is reached at the port the shell picked, not 8765", async () => {
    tauri.invoke.mockImplementation(async (cmd: string) =>
      cmd === "get_backend_url" ? "http://127.0.0.1:54321" : null);
    const fetch = serveHealth({ status: "ok", app: "pedimap2", version: "2.2.2" });
    const { result } = renderHook(() => useBackendHealth());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:54321/api/health", expect.anything());
    expect(fetch.mock.calls.map(c => String(c[0])).join(" ")).not.toContain("8765");
  });

  it("is never another program answering on the port", async () => {
    tauri.invoke.mockImplementation(async (cmd: string) =>
      cmd === "get_backend_url" ? "http://127.0.0.1:54321" : report({ running: false, exitCode: 1, portInUse: true }));
    serveHealth({ status: "ok", service: "something else" });
    const { result } = renderHook(() => useBackendHealth());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.failure.foreign).toBe(true);
    expect(explainBackendFailure(result.current.failure).join("\n"))
      .toContain("Another program answered at http://127.0.0.1:54321. It is not Pedimap's backend");
  });

  it("health replies count only with the pedimap2 id", () => {
    expect(isPedimapHealth({ status: "ok", app: "pedimap2", version: "2.2.2" })).toBe(true);
    for (const body of [{ status: "ok" }, { app: "other" }, null, "ok", []]) {
      expect(isPedimapHealth(body)).toBe(false);
    }
  });
});

describe("Show details", () => {
  const failure = (r: Partial<BackendReport> | null, lastError = "Load failed") =>
    ({ url: "http://127.0.0.1:54321", lastError, foreign: false, report: r && report(r) });

  it("says when the port was taken, and what to do", () => {
    const text = explainBackendFailure(failure({
      running: false, exitCode: 1, portInUse: true,
      stderrTail: ["ERROR:    [Errno 48] error while attempting to bind on address: address already in use"],
    })).join("\n");
    expect(text).toContain("The backend service stopped with exit code 1.");
    expect(text).toContain("Port 54321 is already in use by another program. Quit that program, then click Retry.");
    expect(text).toContain("Last messages from the backend service:\n" +
                           "ERROR:    [Errno 48] error while attempting to bind on address: address already in use");
    expect(text).toContain("Last error: Load failed");
  });

  it("explains a backend that could not start, or runs without answering", () => {
    expect(explainBackendFailure(failure({ running: false, spawnError: "could not find the backend program: x" })))
      .toContain("Pedimap could not start its backend service: could not find the backend program: x.");
    expect(explainBackendFailure(failure({ running: false, exitSignal: 9 }))[0])
      .toBe("The backend service stopped on signal 9.");
    expect(explainBackendFailure(failure({ running: true }))[0])
      .toBe("The backend service is running but did not answer at http://127.0.0.1:54321.");
    expect(explainBackendFailure(failure(null, "")).join("")).toBe("No error detail available.");
  });
});

describe("a missing backend program", () => {
  const failure = (r: Partial<BackendReport>) =>
    ({ url: "http://127.0.0.1:54321", lastError: "Load failed", foreign: false, report: report(r) });
  const LINK = "https://github.com/Fresnedo-Lab/pedimap2/releases/latest";

  it("ends Show details with how to reinstall Pedimap 2, with the link", () => {
    expect(REINSTALL_HINT).toBe(`Reinstall Pedimap 2 from the Releases page: ${LINK}`);
    for (const spawnError of [
      "could not start the backend program: No such file or directory (os error 2)",   // macOS (seen)
      "could not find the backend program: sidecar not found",
      "could not start the backend program: The system cannot find the file specified. (os error 2)",  // Windows
    ]) {
      const lines = explainBackendFailure(failure({ running: false, spawnError }));
      expect(lines.at(-1), spawnError).toBe(REINSTALL_HINT);
      expect(lines[0]).toBe(`Pedimap could not start its backend service: ${spawnError}.`);
    }
  });

  it("is not suggested for other failures", () => {
    for (const r of [
      { running: false, spawnError: "could not start the backend program: Permission denied (os error 13)" },
      { running: false, exitCode: 1, portInUse: true },
      { running: true },
    ]) {
      expect(explainBackendFailure(failure(r)).join("\n")).not.toContain("Reinstall");
    }
  });
});

describe("the Show details link", () => {
  it("opens the Releases page in the system browser", async () => {
    const { BackendGate } = await import("../App");
    const opened = vi.fn();
    render(<BackendGate status="error" onRetry={() => {}} onOpenLink={opened}
      failure={{ url: "http://127.0.0.1:54321", lastError: "Load failed", foreign: false,
                 report: report({ running: false,
                   spawnError: "could not start the backend program: No such file or directory (os error 2)" }) }} />);
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    const link = screen.getByRole("link", { name: "https://github.com/Fresnedo-Lab/pedimap2/releases/latest" });
    expect(link.closest("pre")!.textContent!.endsWith(REINSTALL_HINT)).toBe(true);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(opened).toHaveBeenCalledWith("https://github.com/Fresnedo-Lab/pedimap2/releases/latest");
    expect(click.defaultPrevented).toBe(true);                // not opened inside the app window
  });
});

// The onefile sidecar takes 9–12 s to answer, more on a busy machine: the
// window waits while the shell reports it running, and gives up only when it
// exits, cannot start, or has not answered in HEALTH_TIMEOUT_MS.
describe("a backend that is slow to start", () => {
  const URL = "http://127.0.0.1:54321";
  let shell: BackendReport;
  let listening: boolean;

  function start(initial: Partial<BackendReport> = {}) {
    vi.useFakeTimers();
    shell = report(initial);
    listening = false;
    tauri.invoke.mockImplementation(async (cmd: string) =>
      cmd === "get_backend_url" ? shell.url : cmd === "backend_report" ? shell : null);
    const fetch = vi.fn(async () => {
      if (!listening) throw new TypeError("Load failed");     // connection refused
      return new Response(JSON.stringify({ status: "ok", app: "pedimap2" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    return { fetch, hook: renderHook(() => useBackendHealth()) };
  }
  const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  afterEach(() => { vi.useRealTimers(); });

  it("keeps starting past 15 s, says it can take longer, then is ready", async () => {
    const { hook } = start();
    await wait(HEALTH_SLOW_MS - 1000);
    expect([hook.result.current.status, hook.result.current.slow]).toEqual(["starting", false]);
    await wait(2000);
    expect([hook.result.current.status, hook.result.current.slow]).toEqual(["starting", true]);
    listening = true;                                          // 20 s: Uvicorn running
    await wait(4000);
    expect(hook.result.current.status).toBe("ready");
  });

  it("gives up at once when the backend exits or cannot start", async () => {
    const { hook } = start();
    await wait(3000);
    shell = { ...shell, running: false, exitCode: 1 };
    await wait(1000);
    expect(hook.result.current.status).toBe("error");
    expect(explainBackendFailure(hook.result.current.failure)[0])
      .toBe("The backend service stopped with exit code 1.");

    hook.unmount(); forgetBackendUrl();
    const second = start({ running: false, spawnError: "could not start the backend program: x" });
    await wait(1000);
    expect(second.hook.result.current.status).toBe("error");
  });

  it("gives up after 60 s on a backend that runs but never answers", async () => {
    const { hook } = start();
    await wait(HEALTH_TIMEOUT_MS - 1000);
    expect(hook.result.current.status).toBe("starting");
    await wait(2000);
    expect(hook.result.current.status).toBe("error");
    expect(explainBackendFailure(hook.result.current.failure).join("\n"))
      .toContain(`The backend service is running but did not answer at ${URL}.`);
  });

  it("waits for the address before the shell has started the backend", async () => {
    const { fetch, hook } = start({ port: 0, url: "", running: false });
    await wait(2000);                                         // setup has not run yet
    expect(fetch).not.toHaveBeenCalled();                     // never the page's own server
    expect(hook.result.current.status).toBe("starting");
    shell = report({});                                       // spawned
    listening = true;
    await wait(1000);
    expect(hook.result.current.status).toBe("ready");
    expect(fetch).toHaveBeenCalledWith(`${URL}/api/health`, expect.anything());
  });

  it("stops polling once the backend answers", async () => {
    const { fetch, hook } = start();
    listening = true;
    await wait(1000);
    expect(hook.result.current.status).toBe("ready");
    const calls = [fetch.mock.calls.length, tauri.invoke.mock.calls.length];
    await wait(10_000);
    expect([fetch.mock.calls.length, tauri.invoke.mock.calls.length]).toEqual(calls);
  });

  it("aborts the health check in flight when it stops, and one that never answers", async () => {
    vi.useFakeTimers();
    tauri.invoke.mockImplementation(async (cmd: string) =>
      cmd === "get_backend_url" ? URL : cmd === "backend_report" ? report({}) : null);
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      signals.push(init!.signal!);                            // accepted, never answered
      init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const hook = renderHook(() => useBackendHealth());
    await wait(HEALTH_ATTEMPT_MS + HEALTH_INTERVAL_MS + 100);
    expect(signals[0].aborted).toBe(true);                    // given up after 3 s …
    expect(signals.length).toBe(2);                           // … and asked again
    expect(hook.result.current.status).toBe("starting");
    hook.unmount();
    expect(signals[1].aborted).toBe(true);                    // nothing left in flight
    await wait(10_000);
    expect(signals.length).toBe(2);                           // and no more checks
  });
});

describe("the starting screen", () => {
  it("says Pedimap is starting, and after 15 s that it can take longer", async () => {
    const { BackendGate } = await import("../App");
    const failure = { url: null, lastError: null, foreign: false, report: null };
    const { rerender } = render(<BackendGate status="starting" failure={failure}
      onRetry={() => {}} onOpenLink={() => {}} />);
    expect(screen.getByRole("status").textContent).toBe("Starting Pedimap…");
    expect(screen.queryByText(/take longer/)).toBeNull();
    rerender(<BackendGate status="starting" slow failure={failure} onRetry={() => {}} onOpenLink={() => {}} />);
    expect(screen.getByText(/can take longer the first time Pedimap starts/)).toBeTruthy();
    expect(screen.queryByText(/Cannot reach/)).toBeNull();
  });
});
