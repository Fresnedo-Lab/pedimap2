// The desktop app reaches its backend only at the URL the Rust shell gives
// (a free port, never a fixed fallback), accepts only a health reply that
// identifies Pedimap's backend, and explains failures in plain words.

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const tauri = vi.hoisted(() => ({ desktop: true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => tauri.desktop,
  invoke: tauri.invoke,
}));

import {
  explainBackendFailure, forgetBackendUrl, isPedimapHealth, useBackendHealth,
  type BackendReport,
} from "./useApi";

const report = (r: Partial<BackendReport>): BackendReport => ({
  port: 54321, url: "http://127.0.0.1:54321", running: true, spawnError: null,
  exitCode: null, exitSignal: null, portInUse: false, stderrTail: [], ...r,
});

function serveHealth(body: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => { vi.unstubAllGlobals(); tauri.invoke.mockReset(); forgetBackendUrl(); });

describe("the desktop app's backend", () => {
  it("is reached at the port the shell picked, not 8765", async () => {
    tauri.invoke.mockImplementation(async (cmd: string) =>
      cmd === "get_backend_url" ? "http://127.0.0.1:54321" : null);
    const fetch = serveHealth({ status: "ok", app: "pedimap2", version: "2.2.2" });
    const { result } = renderHook(() => useBackendHealth());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:54321/api/health");
    expect(fetch.mock.calls.flat().join(" ")).not.toContain("8765");
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
