// hooks/useApi.ts
// ================
// Type-safe fetch wrapper.  In the Tauri desktop app the backend URL is
// retrieved from the Rust command; in plain-browser dev mode it falls
// back to localhost:8765.

import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IndividualSummary {
  id:         string;
  name:       string;
  generation: number;
  cross_type: string;
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
  ancestors:     number;
  descendants:   number;
  siblings:      number;
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

async function resolveBackendUrl(): Promise<string> {
  if (_backendUrl) return _backendUrl;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    _backendUrl = await invoke<string>("get_backend_url");
  } catch {
    _backendUrl = "http://127.0.0.1:8765";
  }
  return _backendUrl!;
}

// ── Core fetch helper ─────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const base = await resolveBackendUrl();
  const res  = await fetch(`${base}${path}`, options);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface ApiClient {
  getStats():                              Promise<StatsData>;
  getPedigree():                           Promise<PedigreeData>;
  getGraph():                              Promise<GraphData>;
  getLayout():                             Promise<Record<string, {x:number;y:number}>>;
  listIndividuals():                       Promise<IndividualSummary[]>;
  getIndividual(id: string):               Promise<IndividualDetail>;
  getColorMap(traitName: string):          Promise<Record<string, string>>;
  buildSubpop(params: {
    focal_id: string;
    ancestors?: boolean;
    descendants?: boolean;
    siblings?: boolean;
  }):                                      Promise<GraphData>;
  loadFile(files: FileList | File[]):      Promise<{loaded: string; individuals: number}>;
  reset():                                 Promise<void>;
}

export function useApi(): ApiClient {
  return {
    getStats:       ()   => apiFetch("/api/stats"),
    getPedigree:    ()   => apiFetch("/api/pedigree"),
    getGraph:       ()   => apiFetch("/api/graph"),
    getLayout:      ()   => apiFetch("/api/layout"),
    listIndividuals:()   => apiFetch("/api/individuals"),
    getIndividual:  (id) => apiFetch(`/api/individual/${encodeURIComponent(id)}`),
    getColorMap:    (t)  => {
      // Issue 1: a color request must never be issued without a trait name.
      // The backend route is /api/color/{trait_name}; calling it with an empty
      // trait produces /api/color/ → 404. Treat empty/null/undefined as "no
      // coloring" and return the default (empty) map without hitting the API.
      if (!t) return Promise.resolve<Record<string, string>>({});
      return apiFetch(`/api/color/${encodeURIComponent(t)}`);
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

export function useBackendHealth(): {
  status: BackendStatus;
  lastError: string | null;
  retry: () => void;
} {
  const [status,    setStatus]    = useState<BackendStatus>("starting");
  const [lastError, setLastError] = useState<string | null>(null);
  const [attempt,   setAttempt]   = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    setStatus("starting");
    setLastError(null);

    const poll = async () => {
      if (cancelled) return;
      try {
        const base = await resolveBackendUrl();
        const res  = await fetch(`${base}/api/health`);
        if (cancelled) return;
        if (res.ok) { setStatus("ready"); return; }
        setLastError(`Health check returned HTTP ${res.status}`);
      } catch (e) {
        if (cancelled) return;
        setLastError(e instanceof Error ? e.message : String(e));
      }
      // Still not ready: give up after the timeout, otherwise poll again.
      if (Date.now() - started >= HEALTH_TIMEOUT_MS) {
        setStatus("error");
        return;
      }
      timer = setTimeout(poll, HEALTH_INTERVAL_MS);
    };

    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [attempt]);

  const retry = useCallback(() => setAttempt(a => a + 1), []);
  return { status, lastError, retry };
}
