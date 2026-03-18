// hooks/useApi.ts
// ================
// Type-safe fetch wrapper.  In the Tauri desktop app the backend URL is
// retrieved from the Rust command; in plain-browser dev mode it falls
// back to localhost:5173.

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
  id:         string;
  label:      string;
  x:          number;
  y:          number;
  generation: number;
  cross_type: string;
  is_focal?:  boolean;
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
    const { invoke } = await import("@tauri-apps/api/tauri");
    _backendUrl = await invoke<string>("get_backend_url");
  } catch {
    _backendUrl = "http://127.0.0.1:5173";
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
    getColorMap:    (t)  => apiFetch(`/api/color/${encodeURIComponent(t)}`),
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

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}
