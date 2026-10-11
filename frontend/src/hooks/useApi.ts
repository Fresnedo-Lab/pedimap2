// hooks/useApi.ts
// ================
// Type-safe fetch wrapper.  In the Tauri desktop app the backend URL comes
// from the Rust shell, which starts the backend on a free port; in the
// plain-browser dev server and the e2e tests it is 127.0.0.1:8765.

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { LATEST_RELEASE_URL } from "../lib/links";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IndividualSummary {
  id:         string;
  name:       string;
  generation: number;
  cross_type: string;
}

export interface RelativeRef {
  id:   string;
  name: string;
}

export interface IndividualDetail {
  id:            string;
  name:          string;
  female_parent: string | null;
  male_parent:   string | null;
  cross_type:    string;
  ploidy:        number;
  generation:    number;
  traits:        Record<string, number | string>;
  markers:       Record<string, string[]>;
  notes:         string;
  // In pedigree order (parents before children).
  ancestors:     RelativeRef[];
  descendants:   RelativeRef[];
  siblings:      RelativeRef[];
}

export interface GraphNode {
  id:             string;
  label:          string;
  x:              number;
  y:              number;
  generation:     number;
  cross_type:     string;
  female_parent?: string | null;
  male_parent?:   string | null;
  traits?:        Record<string, number | string>;
  is_focal?:      boolean;
}

export interface GraphEdge {
  from: string;
  to:   string;
  role: string;
}

export interface GraphData   { nodes: GraphNode[]; edges: GraphEdge[] }
export interface StatsData   {
  total: number; founders: number; leaves: number;
  traits: number; markers: number;
  population: string; ploidy: number;
}
export interface TraitMeta {
  name: string; type: string; min: number; max: number;
  categories: string[]; color_low: string; color_high: string;
}
export interface MarkerMeta {
  name: string; linkage_group: string; position_cM: number;
}
export interface PedigreeData {
  population: string; ploidy: number;
  traits: TraitMeta[]; markers: MarkerMeta[];
}

// ── Backend URL resolution ────────────────────────────────────────────────────

let _backendUrl: string | null = null;

/** The backend in development (uvicorn on 8765) and the e2e tests. */
const DEV_BACKEND_URL = "http://127.0.0.1:8765";

async function resolveBackendUrl(): Promise<string> {
  if (_backendUrl) return _backendUrl;
  // The desktop app's backend runs on whatever port the shell picked; there
  // is no fallback, so a failure shows up instead of reaching another program.
  _backendUrl = isTauri() ? await invoke<string>("get_backend_url") : DEV_BACKEND_URL;
  return _backendUrl;
}

/** Look the URL up again next time (the backend was restarted, maybe on a new port). */
export function forgetBackendUrl() {
  _backendUrl = null;
}

/** The id /api/health carries; any other reply is not Pedimap's backend. */
export const BACKEND_APP_ID = "pedimap2";

export function isPedimapHealth(body: unknown): boolean {
  return typeof body === "object" && body !== null && (body as { app?: unknown }).app === BACKEND_APP_ID;
}

// ── Core fetch helper ─────────────────────────────────────────────────────────

async function apiResponse(path: string, options?: RequestInit): Promise<Response> {
  const base = await resolveBackendUrl();
  const res  = await fetch(`${base}${path}`, options);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  return (await apiResponse(path, options)).json() as Promise<T>;
}

async function apiFetchText(path: string, options?: RequestInit): Promise<string> {
  return (await apiResponse(path, options)).text();
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface ApiClient {
  getStats():                              Promise<StatsData>;
  getPedigree():                           Promise<PedigreeData>;
  getGraph():                              Promise<GraphData>;
  getLayout():                             Promise<Record<string, {x:number;y:number}>>;
  listIndividuals():                       Promise<IndividualSummary[]>;
  getIndividual(id: string):               Promise<IndividualDetail>;
  getColorMap(traitName: string, colors?: ColorOverrides): Promise<Record<string, string>>;
  buildSubpop(params: {
    focal_id: string;
    ancestors?: boolean;
    descendants?: boolean;
    siblings?: boolean;
  }):                                      Promise<GraphData>;
  loadFile(files: FileList | File[]):      Promise<LoadResult>;
  listDemo():                              Promise<{datasets: {name: string; description: string}[]}>;
  loadDemo(name: string):                  Promise<LoadResult>;
  exportDat(req?: DatExportRequest):       Promise<string>;
  reset():                                 Promise<void>;
}

/** Optional #RRGGBB overrides for /api/color: a continuous trait's gradient
 *  end points and the color of individuals without a value. */
export interface ColorOverrides { low?: string; high?: string; missing?: string }

/** Text encodings the backend and the desktop shell report when reading files. */
export const LEGACY_ENCODING = "windows-1252";

/** Response of /api/load and /api/demo/load. */
export interface LoadResult {
  loaded:      string;
  individuals: number;
  encoding?:   string;                              // of the data file
  files?:      { name: string; encoding: string }[];  // each file received
}

/** The selection behind a displayed subpopulation (as sent to /api/subpop). */
export interface SubpopSelection {
  focal_id:    string;
  ancestors:   boolean;
  descendants: boolean;
  siblings:    boolean;
}

/** Body for POST /api/export/dat. Without ids the whole population is exported. */
export interface DatExportRequest extends Partial<SubpopSelection> {
  ids?: string[];
  // false (default): parents outside `ids` are added as founder rows;
  // true: they are written as unknown, giving a strictly closed set.
  replace_outside_parents?: boolean;
}

export function useApi(): ApiClient {
  return {
    getStats:       ()   => apiFetch("/api/stats"),
    getPedigree:    ()   => apiFetch("/api/pedigree"),
    getGraph:       ()   => apiFetch("/api/graph"),
    getLayout:      ()   => apiFetch("/api/layout"),
    listIndividuals:()   => apiFetch("/api/individuals"),
    getIndividual:  (id) => apiFetch(`/api/individual/${encodeURIComponent(id)}`),
    getColorMap:    (t, colors = {}) => {
      // Issue 1: a color request must never be issued without a trait name.
      // The backend route is /api/color/{trait_name}; calling it with an empty
      // trait produces /api/color/ → 404. Treat empty/null/undefined as "no
      // coloring" and return the default (empty) map without hitting the API.
      if (!t) return Promise.resolve<Record<string, string>>({});
      const query = new URLSearchParams(
        Object.entries(colors).filter((e): e is [string, string] => !!e[1])).toString();
      return apiFetch(`/api/color/${encodeURIComponent(t)}${query ? `?${query}` : ""}`);
    },
    buildSubpop:    (p)  => apiFetch("/api/subpop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    }),
    loadFile: async (files) => {
      const fd = new FormData();
      const arr = Array.from(files);
      const dat = arr.find(f => f.name.endsWith(".dat") || f.name.endsWith(".json"));
      const pmp = arr.find(f => f.name.endsWith(".pmp"));
      if (!dat) throw new Error("Please select a .dat or .json file.");
      fd.append("dat_file", dat, dat.name);
      if (pmp) fd.append("pmp_file", pmp, pmp.name);
      return apiFetch("/api/load", { method: "POST", body: fd });
    },
    listDemo: ()     => apiFetch("/api/demo/list"),
    loadDemo: (name) => apiFetch(`/api/demo/load/${encodeURIComponent(name)}`),
    exportDat: (req = {}) => apiFetchText("/api/export/dat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),
    reset: () => apiFetch("/api/reset", { method: "POST" }),
  };
}

// ── Convenience data-fetching hook ────────────────────────────────────────────

export function useFetch<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
  enabled: boolean = true,
): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [data,    setData]    = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const counter = useRef(0);

  const load = useCallback(async () => {
    const call = ++counter.current;
    setLoading(true); setError(null);
    try {
      const result = await fetcher();
      if (call === counter.current) setData(result);
    } catch (e) {
      if (call === counter.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (call === counter.current) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Issue 2: don't fire until `enabled` is true (backend readiness gate). When
  // it flips true, the effect re-runs and performs the deferred fetch.
  useEffect(() => { if (enabled) load(); }, [load, enabled]);
  return { data, loading, error, reload: load };
}

// ── Backend readiness gate ──────────────────────────────────────────────────
// The PyInstaller sidecar takes 1–3 s to unpack and start. Poll /api/health
// until it answers before any other request is allowed to fire.

export type BackendStatus = "starting" | "ready" | "error";

const HEALTH_INTERVAL_MS = 500;
const HEALTH_TIMEOUT_MS  = 15_000;

/** What the desktop shell knows about the backend process (Rust BackendReport). */
export interface BackendReport {
  port:        number;
  url:         string;
  running:     boolean;
  spawnError:  string | null;
  exitCode:    number | null;
  exitSignal:  number | null;
  portInUse:   boolean;
  stderrTail:  string[];
}

export interface BackendFailure {
  url:        string | null;
  lastError:  string | null;
  /** Something answered at the URL, but not Pedimap's backend. */
  foreign:    boolean;
  report:     BackendReport | null;
}

export function useBackendHealth(): {
  status: BackendStatus;
  failure: BackendFailure;
  retry: () => void;
} {
  const [status,  setStatus]  = useState<BackendStatus>("starting");
  const [failure, setFailure] = useState<BackendFailure>(
    { url: null, lastError: null, foreign: false, report: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    let url: string | null = null;
    let lastError: string | null = null;

    setStatus("starting");
    setFailure({ url: null, lastError: null, foreign: false, report: null });

    // Give up: keep what the desktop shell knows, for "Show details".
    const fail = async (foreign: boolean) => {
      const report = isTauri()
        ? await invoke<BackendReport>("backend_report").catch(() => null) : null;
      if (cancelled) return;
      setFailure({ url, lastError, foreign, report });
      setStatus("error");
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        url = await resolveBackendUrl();
        const res = await fetch(`${url}/api/health`);
        if (cancelled) return;
        if (res.ok) {
          const body = await res.json().catch(() => null);
          if (cancelled) return;
          if (isPedimapHealth(body)) { setStatus("ready"); return; }
          // Another program answers on this port: never talk to it.
          lastError = `${url} answered, but it is not Pedimap's backend.`;
          await fail(true);
          return;
        }
        lastError = `Health check returned HTTP ${res.status}`;
      } catch (e) {
        if (cancelled) return;
        lastError = e instanceof Error ? e.message : String(e);
      }
      // Still not ready: give up after the timeout, otherwise poll again.
      if (Date.now() - started >= HEALTH_TIMEOUT_MS) {
        await fail(false);
        return;
      }
      timer = setTimeout(poll, HEALTH_INTERVAL_MS);
    };

    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [attempt]);

  // Retry restarts the backend if it has stopped (possibly on a new port).
  const retry = useCallback(() => {
    void (async () => {
      if (isTauri()) await invoke("start_backend").catch(() => {});
      forgetBackendUrl();
      setAttempt(a => a + 1);
    })();
  }, []);
  return { status, failure, retry };
}

/** Last line of "Show details" when the backend program is missing. */
export const REINSTALL_HINT = `Reinstall Pedimap 2 from the Releases page: ${LATEST_RELEASE_URL}`;

/**
 * Whether a start failure means the backend program is not there: the shell
 * could not locate it, or the OS found no file to run (error 2: "No such file
 * or directory" on macOS/Linux, "cannot find the file" on Windows).
 */
export function backendProgramMissing(spawnError: string): boolean {
  return /could not find the backend program|os error 2\b|no such file or directory|cannot find the file/i
    .test(spawnError);
}

/**
 * Plain-language explanation of why the backend cannot be reached, for
 * "Show details": what happened to its process, a port conflict and what to
 * do about it, and its last messages.
 */
export function explainBackendFailure(f: BackendFailure): string[] {
  const lines: string[] = [];
  const r = f.report;
  const port = r?.port ?? (f.url ? Number(new URL(f.url).port) : null);
  if (f.foreign) {
    lines.push(`Another program answered at ${f.url}. It is not Pedimap's backend, so ` +
               "Pedimap will not use it.");
  }
  if (r?.spawnError) {
    lines.push(`Pedimap could not start its backend service: ${r.spawnError}.`);
  } else if (r && !r.running) {
    const how = r.exitCode !== null ? `with exit code ${r.exitCode}`
              : r.exitSignal !== null ? `on signal ${r.exitSignal}` : "";
    lines.push(`The backend service stopped ${how}`.trimEnd() + ".");
  } else if (r?.running && !f.foreign) {
    lines.push(`The backend service is running but did not answer at ${f.url ?? r.url}.`);
  }
  if (r?.portInUse || f.foreign) {
    lines.push(`Port ${port} is already in use by another program. Quit that program, ` +
               "then click Retry.");
  }
  if (f.lastError && !f.foreign) lines.push(`Last error: ${f.lastError}`);
  if (r?.stderrTail.length) {
    lines.push("", "Last messages from the backend service:", ...r.stderrTail);
  }
  // A missing program will not come back with Retry: say how to fix it, last.
  if (r?.spawnError && backendProgramMissing(r.spawnError)) lines.push("", REINSTALL_HINT);
  if (!lines.length) lines.push("No error detail available.");
  return lines;
}
