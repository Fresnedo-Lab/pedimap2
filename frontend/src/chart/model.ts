// chart/model.ts
// ==============
// The drawn pedigree chart, built from the backend graph: individuals, the
// optional cross (×) nodes between parents and children, and the links, each
// with its role. The canvas and the image export both draw from this model,
// so what is exported is what is on screen.
//
// Cross nodes exist only here. They are never sent to the backend and never
// listed as individuals (sidebar, search, Information panel, .dat export all
// use the backend's individual ids).

import type { GraphData, GraphNode } from "../hooks/useApi";

/** Connector colors by parental role, in both display styles. */
export const ROLE_COLORS = {
  female:      "#E02020",
  male:        "#2040E0",
  uniparental: "#800080",   // *SELF, *DH, *MUT, *VP
} as const;

export type LinkRole = keyof typeof ROLE_COLORS | "offspring";

/** Cross types with a single parent: no cross node, one purple link. */
const UNIPARENTAL = new Set(["self", "dh", "mut", "clone"]);

export function isUniparental(node: Pick<GraphNode, "cross_type">): boolean {
  return UNIPARENTAL.has(node.cross_type);
}

export interface ChartCross {
  id:       string;
  female:   string | null;   // parent ids as recorded, displayed or not
  male:     string | null;
  children: string[];        // full sibs that share this cross
  level:    number;
}

export interface ChartLink {
  from: string;
  to:   string;
  role: LinkRole;            // "offspring" is cross → child
}

export interface ChartModel {
  individuals: GraphNode[];
  crosses:     ChartCross[];
  links:       ChartLink[];
  /** Layout level of every chart node: 2 × generation for individuals, and one
   *  level above the children for a cross, so it sits between the generations. */
  levels:      Map<string, number>;
  crossIds:    Set<string>;
}

const CROSS_PREFIX = "⁣cross:";   // invisible separator: never in a .dat name

export function isCrossId(id: string): boolean {
  return id.startsWith(CROSS_PREFIX);
}

/**
 * Build the chart for a graph. With `crossSymbols`, children of a biparental
 * cross hang from one × node per parent pair (full sibs share it); without,
 * each parent links straight to the child. A uniparental child always gets a
 * single purple link from its parent. Links are only drawn to parents that are
 * part of the displayed graph.
 */
export function buildChartModel(graph: GraphData, crossSymbols: boolean): ChartModel {
  const shown = new Set(graph.nodes.map(n => n.id));
  const levels = new Map<string, number>();
  for (const n of graph.nodes) levels.set(n.id, 2 * n.generation);

  const links: ChartLink[] = [];
  const crosses = new Map<string, ChartCross>();

  for (const child of graph.nodes) {
    const female = child.female_parent || null;
    const male   = child.male_parent || null;

    if (isUniparental(child)) {
      const parent = female ?? male;
      if (parent && shown.has(parent)) links.push({ from: parent, to: child.id, role: "uniparental" });
      continue;
    }

    const drawn = [
      { id: female, role: "female" as const },
      { id: male,   role: "male"   as const },
    ].filter(p => p.id && shown.has(p.id));
    if (drawn.length === 0) continue;

    if (!crossSymbols) {
      for (const p of drawn) links.push({ from: p.id!, to: child.id, role: p.role });
      continue;
    }

    const id = CROSS_PREFIX + JSON.stringify([female, male]);
    let cross = crosses.get(id);
    if (!cross) {
      cross = { id, female, male, children: [], level: 2 * child.generation - 1 };
      crosses.set(id, cross);
      for (const p of drawn) links.push({ from: p.id!, to: id, role: p.role });
    }
    cross.children.push(child.id);
    cross.level = Math.min(cross.level, 2 * child.generation - 1);
    links.push({ from: id, to: child.id, role: "offspring" });
  }

  for (const c of crosses.values()) levels.set(c.id, c.level);
  return {
    individuals: graph.nodes,
    crosses:     [...crosses.values()],
    links,
    levels,
    crossIds:    new Set(crosses.keys()),
  };
}

/** Color of a link in a display style; offspring links use the style's ink. */
export function linkColor(role: LinkRole, offspring: string): string {
  return role === "offspring" ? offspring : ROLE_COLORS[role];
}

/**
 * Simple level-by-level grid positions, for tests and for exporting without a
 * live canvas. The canvas itself uses vis-network's hierarchical layout.
 */
export function gridLayout(
  model: ChartModel, spacing = { level: 70, sibling: 140 },
): Record<string, { x: number; y: number }> {
  const byLevel = new Map<number, string[]>();
  for (const [id, level] of model.levels) {
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level)!.push(id);
  }
  const pos: Record<string, { x: number; y: number }> = {};
  for (const [level, ids] of byLevel) {
    const width = (ids.length - 1) * spacing.sibling;
    ids.forEach((id, i) => { pos[id] = { x: i * spacing.sibling - width / 2, y: level * spacing.level }; });
  }
  return pos;
}
