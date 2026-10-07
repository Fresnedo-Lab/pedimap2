// Test data: the backend's API output for backend/tests/fixtures/apple_public.dat
// (kept current by backend/tests/test_frontend_fixture.py), and synthetic
// pedigrees built in code.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GraphData, GraphNode, PedigreeData } from "../hooks/useApi";
import apple from "./fixtures/apple_public.json";

export const applePedigree = apple.pedigree as unknown as PedigreeData;
export const appleGraph    = apple.graph as unknown as GraphData;
export const appleGala     = apple.subpop_gala as unknown as GraphData;
export const appleColorS1S2: Record<string, string> = apple.color_S1_S2;

/** A graph from [id, female, male, cross_type?] rows, generations computed. */
export function syntheticGraph(rows: [string, string | null, string | null, string?][]): GraphData {
  const gen = new Map<string, number>();
  const nodes: GraphNode[] = rows.map(([id, f, m, ct]) => {
    const g = Math.max(-1, ...[f, m].filter(Boolean).map(p => gen.get(p!) ?? 0)) + 1;
    gen.set(id, g);
    return { id, label: id, x: 0, y: 0, generation: g,
             cross_type: ct ?? (f || m ? "cross" : "unknown"),
             female_parent: f, male_parent: m, traits: {} };
  });
  return { nodes, edges: [] };
}

/** The bundled chart font, as the app loads it for exports. */
export function notoSansBase64(): string {
  // Tests run from frontend/ (npm test).
  return readFileSync(resolve("src/assets/fonts/NotoSans-Regular.ttf")).toString("base64");
}
