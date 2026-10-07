// A reproducible synthetic breeding pedigree of any size, for layout timing
// and routing tests: founders, full-sib families, selfings, unknown fathers,
// and parents drawn mostly from the last two generations but sometimes from
// much older ones (links that span several generations).

import type { GraphData, GraphNode } from "../hooks/useApi";

// Small deterministic PRNG (mulberry32), so a seed always gives the same pedigree.
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `size` individuals over `generations` generations (by default 8 for 500,
 * 9 for 1,000): founders, then each generation from the one before it, with
 * about a quarter of parents taken from older generations.
 */
export function syntheticPedigree(size: number, seed = 1,
                                  generations = Math.round(4 + Math.log2(size / 30))): GraphData {
  const rnd = random(seed);
  const pick = <T,>(items: T[]) => items[Math.floor(rnd() * items.length)];
  const nodes: GraphNode[] = [];
  const byGeneration: GraphNode[][] = [];
  const add = (female: GraphNode | null, male: GraphNode | null, crossType: string) => {
    const generation = Math.max(-1, ...[female, male].filter(Boolean).map(p => p!.generation)) + 1;
    const node: GraphNode = {
      id: `S${String(nodes.length).padStart(5, "0")}`, label: "", x: 0, y: 0, generation,
      cross_type: crossType, female_parent: female?.id ?? null, male_parent: male?.id ?? null, traits: {},
    };
    node.label = node.id;
    nodes.push(node);
    (byGeneration[generation] ??= []).push(node);
  };

  const founders = Math.max(4, Math.round(size * 0.08));
  for (let i = 0; i < founders; i++) add(null, null, "unknown");
  const perGeneration = Math.ceil((size - founders) / (generations - 1));

  for (let g = 1; g < generations && nodes.length < size; g++) {
    const previous = byGeneration[g - 1];
    const older = nodes.filter(n => n.generation < g - 1);
    const target = Math.min(size, nodes.length + perGeneration);
    while (nodes.length < target) {
      // One parent from the previous generation keeps the child in this one.
      const recent = pick(previous);
      const other = older.length && rnd() < 0.25 ? pick(older) : pick(previous);
      const kind = rnd();
      const recentIsMother = rnd() < 0.5;
      const mate = other === recent ? null : other;
      const family = 1 + Math.floor(rnd() * 5);              // full sibs
      for (let i = 0; i < family && nodes.length < target; i++) {
        if (kind < 0.06) add(recent, recent, "self");
        else if (kind < 0.10) add(recent, null, "cross");    // unknown father
        else if (recentIsMother || !mate) add(recent, mate, "cross");
        else add(mate, recent, "cross");
      }
    }
  }
  return { nodes, edges: [] };
}

/** The pedigree as a .dat file (selfings written as the same parent twice). */
export function toDat(graph: GraphData, population = "Synthetic"): string {
  const rows = graph.nodes.map(n => `${n.id}\t${n.female_parent ?? "-"}\t${n.male_parent ?? "-"}`);
  return [`POPULATION = ${population}`, "UNKNOWN = -", "", "PEDIGREE", "NAME\tFEMALE\tMALE", ...rows, ""].join("\n");
}
