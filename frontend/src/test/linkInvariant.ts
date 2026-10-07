// The chart invariant for links: a drawn link may touch only the boxes of the
// two nodes it connects. Crossing any other individual or cross node would
// imply a parentage that does not exist (or hide a real link).

import type { GraphData } from "../hooks/useApi";

export type Point = { x: number; y: number };
export interface Box { left: number; right: number; top: number; bottom: number }

/** A drawn link as a polyline, and the ids of the two nodes it connects. */
export interface DrawnLink { from: string; to: string; points: Point[] }

export interface Violation { from: string; to: string; crosses: string }

// Boxes are shrunk by this much so a link that only touches an edge (or ends
// on one) is not counted.
const TOLERANCE = 0.5;

/** Whether segment p→q enters the open interior of `b` (Liang–Barsky). */
export function segmentHitsBox(p: Point, q: Point, b: Box): boolean {
  const left = b.left + TOLERANCE, right = b.right - TOLERANCE;
  const top = b.top + TOLERANCE, bottom = b.bottom - TOLERANCE;
  if (left >= right || top >= bottom) return false;
  const dx = q.x - p.x, dy = q.y - p.y;
  let t0 = 0, t1 = 1;
  for (const [pp, qq] of [[-dx, p.x - left], [dx, right - p.x], [-dy, p.y - top], [dy, bottom - p.y]]) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const r = qq / pp;
    if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else        { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 < t1;
}

export function violations(links: DrawnLink[], boxes: Map<string, Box>): Violation[] {
  const found: Violation[] = [];
  for (const link of links) {
    const xs = link.points.map(p => p.x), ys = link.points.map(p => p.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (const [id, box] of boxes) {
      if (id === link.from || id === link.to) continue;
      if (box.right < minX || box.left > maxX || box.bottom < minY || box.top > maxY) continue;
      for (let i = 1; i < link.points.length; i++) {
        if (segmentHitsBox(link.points[i - 1], link.points[i], box)) {
          found.push({ from: link.from, to: link.to, crosses: id });
          break;
        }
      }
    }
  }
  return found;
}

/**
 * Every subpopulation the app can build with "Subpop": each individual with
 * its ancestors and descendants (as /api/subpop), in pedigree order, keeping
 * the generations of the full population. Duplicate sets are dropped.
 */
export function subpopulations(graph: GraphData): { focal: string; graph: GraphData }[] {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const ids = new Set(graph.nodes.map(n => n.id));
  for (const n of graph.nodes) {
    const ps = [...new Set([n.female_parent, n.male_parent])].filter((p): p is string => !!p && ids.has(p));
    parents.set(n.id, ps);
    for (const p of ps) children.set(p, [...(children.get(p) ?? []), n.id]);
  }
  const walk = (start: string, next: Map<string, string[]>) => {
    const seen = new Set<string>();
    const stack = [...(next.get(start) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(next.get(id) ?? []));
    }
    return seen;
  };
  const seenSets = new Set<string>();
  const result: { focal: string; graph: GraphData }[] = [];
  for (const focal of graph.nodes) {
    const keep = new Set([focal.id, ...walk(focal.id, parents), ...walk(focal.id, children)]);
    const nodes = graph.nodes.filter(n => keep.has(n.id));
    const key = nodes.map(n => n.id).join("\u0000");
    if (nodes.length < 2 || seenSets.has(key)) continue;
    seenSets.add(key);
    result.push({ focal: focal.id, graph: {
      nodes: nodes.map(n => ({ ...n, is_focal: n.id === focal.id })),
      edges: graph.edges.filter(e => keep.has(e.from) && keep.has(e.to)),
    } });
  }
  return result;
}
