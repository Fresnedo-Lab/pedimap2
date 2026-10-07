// chart/routing.ts
// ================
// The path of every link, computed from node positions and boxes. The canvas
// draws these paths and the SVG/PDF/PNG export writes the same ones, so links
// are routed identically on screen and in exports.
//
// Each level of the hierarchical layout is a band (the extent of the boxes on
// it), and the space between two neighboring bands holds no node. A link
// therefore runs:
//   - straight along the layout direction inside a band, at its own node's
//     position (a lane no other node on that level occupies), and
//   - from band to band only through the empty space between them.
// A link that spans several levels passes through its waypoints (see
// chart/model.ts), whose lanes the layout reserves. So a link can never cross
// a node it does not connect.

import { linkPath, type ChartLink, type ChartModel, type LinkRole } from "./model";

export type Point = { x: number; y: number };
export interface Box { left: number; right: number; top: number; bottom: number }

export type Piece =
  | { kind: "L"; to: Point }
  | { kind: "C"; c1: Point; c2: Point; to: Point };

export interface RoutedLink {
  link:   ChartLink;
  role:   LinkRole;
  start:  Point;
  pieces: Piece[];
  /** Arrowhead polygon at the end (styles with arrows, links into individuals). */
  arrow:  Point[] | null;
}

export interface RouteOptions {
  orientation:     "UD" | "LR";
  /** Cubic curves between bands (Modern) instead of straight lines (Classic). */
  curved:          boolean;
  arrows:          boolean;
  crossSymbolSize: number;
}

const ARROW_LENGTH = 9;
const ARROW_WIDTH  = 7;

/**
 * Boxes of every chart node: individuals as drawn (`boxes`), crosses as their
 * × symbol, waypoints as a point.
 */
export function chartBoxes(
  model: ChartModel, positions: Record<string, Point>, boxes: Record<string, Box>,
  crossSymbolSize: number,
): Map<string, Box> {
  const all = new Map<string, Box>();
  const square = (p: Point, half: number): Box =>
    ({ left: p.x - half, right: p.x + half, top: p.y - half, bottom: p.y + half });
  for (const n of model.individuals) if (positions[n.id] && boxes[n.id]) all.set(n.id, boxes[n.id]);
  for (const c of model.crosses) if (positions[c.id]) all.set(c.id, square(positions[c.id], crossSymbolSize / 2));
  for (const w of model.waypoints) if (positions[w.id]) all.set(w.id, square(positions[w.id], 0));
  return all;
}

export function routeLinks(
  model: ChartModel, positions: Record<string, Point>, boxes: Record<string, Box>,
  opts: RouteOptions,
): RoutedLink[] {
  const ud = opts.orientation === "UD";
  // Coordinates along the layout direction (`a`, increasing from parent to
  // child) and across it (`c`), and back to a point.
  const along  = (p: Point) => (ud ? p.y : p.x);
  const across = (p: Point) => (ud ? p.x : p.y);
  const pt = (c: number, a: number): Point => (ud ? { x: c, y: a } : { x: a, y: c });
  const lo = (b: Box) => (ud ? b.top : b.left);
  const hi = (b: Box) => (ud ? b.bottom : b.right);

  const all = chartBoxes(model, positions, boxes, opts.crossSymbolSize);

  // Band of each level: from the lowest box start to the highest box end.
  const band = new Map<number, { lo: number; hi: number }>();
  for (const [id, box] of all) {
    const level = model.levels.get(id);
    if (level === undefined) continue;
    const b = band.get(level);
    band.set(level, b ? { lo: Math.min(b.lo, lo(box)), hi: Math.max(b.hi, hi(box)) }
                      : { lo: lo(box), hi: hi(box) });
  }

  // Links leave and enter an individual at the middle of its box edge, and
  // meet at the center of a cross (or pass through a waypoint).
  const isPoint = (id: string) => model.crossIds.has(id) || model.waypointIds.has(id);
  const exit = (id: string) => {
    const p = positions[id];
    return isPoint(id) ? p : pt(across(p), hi(all.get(id)!));
  };
  const entry = (id: string) => {
    const p = positions[id];
    return isPoint(id) ? p : pt(across(p), lo(all.get(id)!));
  };

  const routes: RoutedLink[] = [];
  for (const link of model.links) {
    const path = linkPath(link);
    if (!path.every(id => positions[id] && all.has(id))) continue;

    const start = exit(path[0]);
    const pieces: Piece[] = [];
    let at = start;
    const lineTo = (to: Point) => {
      if (Math.abs(to.x - at.x) > 1e-6 || Math.abs(to.y - at.y) > 1e-6) pieces.push({ kind: "L", to });
      at = to;
    };

    for (let i = 0; i + 1 < path.length; i++) {
      const from = path[i], to = path[i + 1];
      const last = i + 2 === path.length;
      const bandFrom = band.get(model.levels.get(from)!)!;
      const bandTo   = band.get(model.levels.get(to)!)!;
      const cFrom = across(positions[from]), cTo = across(positions[to]);

      // Out of this band along the node's own lane.
      lineTo(pt(cFrom, Math.max(along(at), bandFrom.hi)));
      const target = last ? entry(to) : positions[to];
      if (bandTo.lo <= along(at)) {
        // Bands overlap (cannot happen with the layout's spacing, and dragging
        // keeps nodes in their rows): no empty space, so go straight there.
        lineTo(target);
        continue;
      }
      // Across the empty space between the bands to the next lane.
      const into = pt(cTo, bandTo.lo);
      if (opts.curved && Math.abs(cTo - cFrom) > 1e-6) {
        const mid = (along(at) + bandTo.lo) / 2;
        pieces.push({ kind: "C", c1: pt(cFrom, mid), c2: pt(cTo, mid), to: into });
        at = into;
      } else {
        lineTo(into);
      }
      // Into the target, or on through the waypoint's band (next iteration).
      if (last) lineTo(target);
    }

    const toIndividual = !isPoint(link.to);
    routes.push({ link, role: link.role, start, pieces,
                  arrow: opts.arrows && toIndividual ? arrowAt(at, ud) : null });
  }
  return routes;
}

// Arrowhead whose tip is `tip`, pointing along the layout direction (every
// route ends travelling that way into its target).
function arrowAt(tip: Point, ud: boolean): Point[] {
  const back = (d: number, side: number) =>
    ud ? { x: tip.x + side, y: tip.y - d } : { x: tip.x - d, y: tip.y + side };
  return [tip, back(ARROW_LENGTH, ARROW_WIDTH / 2), back(ARROW_LENGTH, -ARROW_WIDTH / 2)];
}

// ── Output ───────────────────────────────────────────────────────────────────

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/** SVG path data of a route. */
export function svgPathData(r: RoutedLink): string {
  const p = (q: Point) => `${fmt(q.x)},${fmt(q.y)}`;
  return [`M${p(r.start)}`, ...r.pieces.map(s =>
    s.kind === "L" ? `L${p(s.to)}` : `C${p(s.c1)} ${p(s.c2)} ${p(s.to)}`)].join(" ");
}

/** Draw routes on a canvas (in chart coordinates). */
export function drawRoutes(
  ctx: CanvasRenderingContext2D, routes: RoutedLink[], color: (role: LinkRole) => string,
  width = 1.5,
) {
  ctx.save();
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const r of routes) {
    ctx.strokeStyle = color(r.role);
    ctx.beginPath();
    ctx.moveTo(r.start.x, r.start.y);
    for (const s of r.pieces) {
      if (s.kind === "L") ctx.lineTo(s.to.x, s.to.y);
      else ctx.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.to.x, s.to.y);
    }
    ctx.stroke();
    if (r.arrow) {
      ctx.fillStyle = color(r.role);
      ctx.beginPath();
      ctx.moveTo(r.arrow[0].x, r.arrow[0].y);
      for (const q of r.arrow.slice(1)) ctx.lineTo(q.x, q.y);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

/** A route as a polyline (curves sampled), for geometry checks. */
export function routePolyline(r: RoutedLink, samples = 16): Point[] {
  const points = [r.start];
  let at = r.start;
  for (const s of r.pieces) {
    if (s.kind === "L") points.push(s.to);
    else {
      for (let i = 1; i <= samples; i++) {
        const t = i / samples, u = 1 - t;
        const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
        points.push({
          x: k[0] * at.x + k[1] * s.c1.x + k[2] * s.c2.x + k[3] * s.to.x,
          y: k[0] * at.y + k[1] * s.c1.y + k[2] * s.c2.y + k[3] * s.to.y,
        });
      }
    }
    at = s.to;
  }
  return points;
}

// ── Dragging ─────────────────────────────────────────────────────────────────

/** Clearance kept between a dragged node and its neighbors in the row. */
const DRAG_GAP = 8;

/**
 * Where a dragged node may go: along its own row only (horizontally in
 * top-to-bottom, vertically in left-to-right), between its neighbors on that
 * row, keeping clear of them. Its row, and so every band and lane the routing
 * relies on, stays intact, so links never have to cross a box.
 */
export interface DragRange { along: number; min: number; max: number }

export function dragRange(
  model: ChartModel, positions: Record<string, Point>, boxes: Record<string, Box>,
  id: string, opts: Pick<RouteOptions, "orientation" | "crossSymbolSize">,
): DragRange | null {
  const ud = opts.orientation === "UD";
  const all = chartBoxes(model, positions, boxes, opts.crossSymbolSize);
  const own = all.get(id), p = positions[id], level = model.levels.get(id);
  if (!own || !p || level === undefined) return null;
  const across = (q: Point) => (ud ? q.x : q.y);
  const lo = (b: Box) => (ud ? b.left : b.top);
  const hi = (b: Box) => (ud ? b.right : b.bottom);

  const c = across(p);
  let prev = -Infinity, next = Infinity;
  for (const [other, box] of all) {
    if (other === id || model.levels.get(other) !== level) continue;
    if (across(positions[other]) < c) prev = Math.max(prev, hi(box));
    else next = Math.min(next, lo(box));
  }
  // Never shrink the range past where the node already is.
  const min = Math.min(c, prev + DRAG_GAP + (c - lo(own)));
  const max = Math.max(c, next - DRAG_GAP - (hi(own) - c));
  return { along: ud ? p.y : p.x, min, max };
}

/** The allowed position closest to `proposed`. */
export function constrainDrag(range: DragRange, proposed: Point, orientation: "UD" | "LR"): Point {
  const ud = orientation === "UD";
  const c = Math.min(range.max, Math.max(range.min, ud ? proposed.x : proposed.y));
  return ud ? { x: c, y: range.along } : { x: range.along, y: c };
}
