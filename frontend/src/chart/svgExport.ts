// chart/svgExport.ts
// ==================
// Build a standalone SVG of the whole chart from node positions and the chart
// model (not a screenshot), reproducing the display style: node shape and
// fill, labels as real <text>, role-colored links, cross symbols, and the
// legend of the active trait. PDF and PNG export both start from this SVG.

import type { GraphNode, TraitMeta } from "../hooks/useApi";
import { linkColor, type ChartLink, type ChartModel } from "./model";
import {
  CHART_FONT, SYMBOL_RADIUS, THEMES, labelInside,
  type DisplayStyle, type NodeShape, type StyleTheme,
} from "./style";

export type Point = { x: number; y: number };
export interface Box { left: number; right: number; top: number; bottom: number }

export interface LegendEntry { label: string; color: string }
export type Legend =
  | { trait: string; kind: "discrete"; entries: LegendEntry[] }
  | { trait: string; kind: "continuous"; min: number; max: number;
      low: string; high: string; missing: string | null };

export interface SvgExportInput {
  model:           ChartModel;
  positions:       Record<string, Point>;
  /** Drawn node rectangles from the canvas; estimated from the label if absent. */
  boxes?:          Record<string, Box>;
  colorMap:        Record<string, string>;
  style:           DisplayStyle;
  orientation:     "UD" | "LR";
  crossSymbolSize: number;
  legend?:         Legend | null;
  /** Base64 TrueType data to embed with @font-face (SVG and PNG; not PDF). */
  fontBase64?:     string;
}

export interface SvgExport { svg: string; width: number; height: number }

const MARGIN = 24;
const LEGEND_GAP = 32;
const LEGEND_ROW = 18;
const SWATCH = 12;

/** Default classic box size; vis-network grows it to fit the label. */
export const CLASSIC_BOX = { minWidth: 80, minHeight: 30, padding: 5 };

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/** Rough text width when no canvas is available to measure it. */
function textWidth(text: string, fontSize: number): number {
  return [...text].length * fontSize * 0.6;
}

function estimateBox(node: GraphNode, p: Point, theme: StyleTheme): Box {
  const shape = theme.shape(node.cross_type);
  if (!labelInside(shape)) {
    const r = SYMBOL_RADIUS;
    const w = Math.max(2 * r, textWidth(node.label, theme.fontSize));
    return { left: p.x - w / 2, right: p.x + w / 2, top: p.y - r,
             bottom: p.y + r + 4 + theme.fontSize * 1.3 };
  }
  const w = Math.max(CLASSIC_BOX.minWidth, textWidth(node.label, theme.fontSize) + 2 * CLASSIC_BOX.padding);
  const h = shape === "box" ? CLASSIC_BOX.minHeight : theme.fontSize + 2 * 6;
  return { left: p.x - w / 2, right: p.x + w / 2, top: p.y - h / 2, bottom: p.y + h / 2 };
}

/** The part of a node that links attach to: its shape, without a label below. */
function anchorBox(shape: NodeShape, p: Point, box: Box): Box {
  if (labelInside(shape)) return box;
  const r = SYMBOL_RADIUS;
  return { left: p.x - r, right: p.x + r, top: p.y - r, bottom: p.y + r };
}

// Where the segment from the center of `b` toward `toward` leaves the shape.
function clip(b: Box, shape: NodeShape, toward: Point): Point {
  const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
  const hw = (b.right - b.left) / 2, hh = (b.bottom - b.top) / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const t = shape === "box" || shape === "square"
    ? Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity)
    : 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2);
  return { x: cx + dx * Math.min(t, 1), y: cy + dy * Math.min(t, 1) };
}

function shapeSvg(shape: NodeShape, p: Point, box: Box, fill: string, stroke: string): string {
  const paint = `fill="${fill}" stroke="${stroke}" stroke-width="1"`;
  const r = SYMBOL_RADIUS;
  const poly = (pts: Point[]) =>
    `<polygon points="${pts.map(q => `${fmt(q.x)},${fmt(q.y)}`).join(" ")}" ${paint}/>`;
  const around = (n: number, rot: number, radius: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => {
      const a = rot + (i * 2 * Math.PI) / n;
      return { x: p.x + radius(i) * Math.cos(a), y: p.y + radius(i) * Math.sin(a) };
    });
  switch (shape) {
    case "box":
      return `<rect x="${fmt(box.left)}" y="${fmt(box.top)}" width="${fmt(box.right - box.left)}" ` +
             `height="${fmt(box.bottom - box.top)}" ${paint}/>`;
    case "ellipse":
      return `<ellipse cx="${fmt(p.x)}" cy="${fmt(p.y)}" rx="${fmt((box.right - box.left) / 2)}" ` +
             `ry="${fmt((box.bottom - box.top) / 2)}" ${paint}/>`;
    case "square":
      return `<rect x="${fmt(p.x - r)}" y="${fmt(p.y - r)}" width="${2 * r}" height="${2 * r}" ${paint}/>`;
    case "diamond":  return poly(around(4, -Math.PI / 2, () => r));
    case "triangle": return poly(around(3, -Math.PI / 2, () => r));
    case "hexagon":  return poly(around(6, 0, () => r));
    case "star":     return poly(around(10, -Math.PI / 2, i => (i % 2 ? r * 0.45 : r)));
  }
}

/** The × of a cross node, as two lines (no text). */
function crossSvg(p: Point, size: number, ink: string): string {
  const h = size / 2;
  return `<g class="cross" stroke="${ink}" stroke-width="1.5" stroke-linecap="round">` +
    `<line x1="${fmt(p.x - h)}" y1="${fmt(p.y - h)}" x2="${fmt(p.x + h)}" y2="${fmt(p.y + h)}"/>` +
    `<line x1="${fmt(p.x - h)}" y1="${fmt(p.y + h)}" x2="${fmt(p.x + h)}" y2="${fmt(p.y - h)}"/></g>`;
}

export function buildSvg(input: SvgExportInput): SvgExport {
  const { model, positions, colorMap, orientation, crossSymbolSize, legend } = input;
  const theme = THEMES[input.style];
  const shapeOf = new Map(model.individuals.map(n => [n.id, theme.shape(n.cross_type)]));

  // ── Geometry ──────────────────────────────────────────────────────────────
  const boxes = new Map<string, Box>();
  for (const n of model.individuals) {
    const p = positions[n.id];
    if (p) boxes.set(n.id, input.boxes?.[n.id] ?? estimateBox(n, p, theme));
  }
  const crossHalf = crossSymbolSize / 2;
  for (const c of model.crosses) {
    const p = positions[c.id];
    if (p) boxes.set(c.id, { left: p.x - crossHalf, right: p.x + crossHalf,
                             top: p.y - crossHalf, bottom: p.y + crossHalf });
  }
  const all = [...boxes.values()];
  const minX = Math.min(...all.map(b => b.left)), maxX = Math.max(...all.map(b => b.right));
  const minY = Math.min(...all.map(b => b.top)),  maxY = Math.max(...all.map(b => b.bottom));
  const ox = MARGIN - (all.length ? minX : 0), oy = MARGIN - (all.length ? minY : 0);
  const chartW = all.length ? maxX - minX : 0, chartH = all.length ? maxY - minY : 0;

  const at = (p: Point): Point => ({ x: p.x + ox, y: p.y + oy });
  const shift = (b: Box): Box => ({ left: b.left + ox, right: b.right + ox, top: b.top + oy, bottom: b.bottom + oy });

  // ── Legend ────────────────────────────────────────────────────────────────
  const legendSvg = legend ? renderLegend(legend, theme, MARGIN + chartW + LEGEND_GAP, MARGIN) : null;
  const width  = MARGIN * 2 + chartW + (legendSvg ? LEGEND_GAP + legendSvg.width : 0);
  const height = MARGIN * 2 + Math.max(chartH, legendSvg?.height ?? 0);

  // ── Links ─────────────────────────────────────────────────────────────────
  const markerId = (color: string) => `arrow-${color.slice(1)}`;
  const markers = new Set<string>();
  const linkSvg = (l: ChartLink): string => {
    const a = positions[l.from], b = positions[l.to];
    if (!a || !b) return "";
    const color = linkColor(l.role, theme.ink);
    const toCross = model.crossIds.has(l.to);
    const end = (id: string, p: Point, other: Point) => {
      if (model.crossIds.has(id)) return at(p);           // links meet at the ×
      const shape = shapeOf.get(id)!;
      return at(clip(anchorBox(shape, p, boxes.get(id)!), shape, other));
    };
    let p1: Point, p2: Point, d: string;
    if (theme.curvedLinks) {
      // Leave and enter along the layout direction, like vis-network's
      // cubic Bézier links with a forced direction.
      const side = (id: string, p: Point, out: boolean): Point => {
        if (model.crossIds.has(id)) return at(p);
        const box = anchorBox(shapeOf.get(id)!, p, boxes.get(id)!);
        return at(orientation === "UD"
          ? { x: p.x, y: out ? box.bottom : box.top }
          : { x: out ? box.right : box.left, y: p.y });
      };
      p1 = side(l.from, a, true);
      p2 = side(l.to, b, false);
      const k = 0.5;
      const c1 = orientation === "UD" ? { x: p1.x, y: p1.y + (p2.y - p1.y) * k } : { x: p1.x + (p2.x - p1.x) * k, y: p1.y };
      const c2 = orientation === "UD" ? { x: p2.x, y: p2.y - (p2.y - p1.y) * k } : { x: p2.x - (p2.x - p1.x) * k, y: p2.y };
      d = `M${fmt(p1.x)},${fmt(p1.y)} C${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)} ${fmt(p2.x)},${fmt(p2.y)}`;
    } else {
      p1 = end(l.from, a, b);
      p2 = end(l.to, b, a);
      d = `M${fmt(p1.x)},${fmt(p1.y)} L${fmt(p2.x)},${fmt(p2.y)}`;
    }
    const arrow = theme.arrows && !toCross;
    if (arrow) markers.add(color);
    return `<path class="link link-${l.role}" d="${d}" fill="none" stroke="${color}" ` +
      `stroke-width="1.5"${arrow ? ` marker-end="url(#${markerId(color)})"` : ""}/>`;
  };
  const links = model.links.map(linkSvg).join("\n");

  // ── Nodes ─────────────────────────────────────────────────────────────────
  const crossesSvg = model.crosses
    .filter(c => positions[c.id])
    .map(c => crossSvg(at(positions[c.id]), crossSymbolSize, theme.ink)).join("\n");

  const nodesSvg = model.individuals.filter(n => positions[n.id]).map(n => {
    const p = at(positions[n.id]);
    const box = shift(boxes.get(n.id)!);
    const shape = shapeOf.get(n.id)!;
    const fill = colorMap[n.id] ?? theme.defaultFill;
    let ty: number;
    if (shape === "box") ty = box.top + CLASSIC_BOX.padding + theme.fontSize * 0.9;  // name on top
    else if (shape === "ellipse") ty = p.y + theme.fontSize * 0.35;
    else ty = p.y + SYMBOL_RADIUS + 4 + theme.fontSize * 0.9;                        // below the symbol
    return `<g class="node">${shapeSvg(shape, p, box, fill, theme.border)}` +
      `<text class="individual" x="${fmt(p.x)}" y="${fmt(ty)}" text-anchor="middle" ` +
      `fill="${theme.text}">${escapeXml(n.label)}</text></g>`;
  }).join("\n");

  // ── Document ──────────────────────────────────────────────────────────────
  const fontFace = input.fontBase64
    ? `<style>@font-face{font-family:"${CHART_FONT}";` +
      `src:url(data:font/ttf;base64,${input.fontBase64}) format("truetype");}</style>`
    : "";
  const markerDefs = [...markers].map(color =>
    `<marker id="${markerId(color)}" viewBox="0 0 10 10" refX="10" refY="5" ` +
    `markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`).join("");

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}" height="${fmt(height)}" ` +
      `viewBox="0 0 ${fmt(width)} ${fmt(height)}" font-family="${CHART_FONT}, sans-serif" ` +
      `font-size="${theme.fontSize}">`,
    `<defs>${fontFace}${markerDefs}</defs>`,
    `<rect class="background" x="0" y="0" width="${fmt(width)}" height="${fmt(height)}" fill="${theme.background}"/>`,
    `<g class="links">${links}</g>`,
    `<g class="crosses">${crossesSvg}</g>`,
    `<g class="nodes">${nodesSvg}</g>`,
    legendSvg ? legendSvg.svg : "",
    `</svg>`,
  ].join("\n");
  return { svg, width, height };
}

// ── Legend ───────────────────────────────────────────────────────────────────

function renderLegend(legend: Legend, theme: StyleTheme, x: number, y: number) {
  const text = (cls: string, tx: number, ty: number, s: string, extra = "") =>
    `<text class="${cls}" x="${fmt(tx)}" y="${fmt(ty)}" fill="${theme.text}"${extra}>${escapeXml(s)}</text>`;
  const swatch = (sx: number, sy: number, color: string) =>
    `<rect x="${fmt(sx)}" y="${fmt(sy)}" width="${SWATCH}" height="${SWATCH}" fill="${color}" stroke="${theme.border}" stroke-width="0.5"/>`;

  // Regular weight only (see svgToPdf); the title is set apart by size.
  const parts = [text("legend-title", x, y + theme.fontSize, legend.trait, ` font-size="${theme.fontSize + 2}"`)];
  let rowY = y + theme.fontSize + 10;
  let width = textWidth(legend.trait, theme.fontSize);

  if (legend.kind === "discrete") {
    for (const e of legend.entries) {
      parts.push(swatch(x, rowY, e.color));
      parts.push(text("legend", x + SWATCH + 6, rowY + SWATCH - 2, e.label));
      width = Math.max(width, SWATCH + 6 + textWidth(e.label, theme.fontSize));
      rowY += LEGEND_ROW;
    }
  } else {
    // Gradient bar from low (min) to high (max), drawn as bands so it renders
    // identically in SVG viewers, svg2pdf and the PNG rasterizer.
    const barW = 120, bands = 24;
    for (let i = 0; i < bands; i++) {
      parts.push(`<rect x="${fmt(x + (i * barW) / bands)}" y="${fmt(rowY)}" width="${fmt(barW / bands + 0.5)}" ` +
        `height="${SWATCH}" fill="${lerpHex(legend.low, legend.high, i / (bands - 1))}"/>`);
    }
    parts.push(`<rect x="${fmt(x)}" y="${fmt(rowY)}" width="${barW}" height="${SWATCH}" fill="none" stroke="${theme.border}" stroke-width="0.5"/>`);
    rowY += SWATCH + theme.fontSize + 2;
    parts.push(text("legend", x, rowY, formatNumber(legend.min)));
    parts.push(text("legend", x + barW, rowY, formatNumber(legend.max), ` text-anchor="end"`));
    rowY += 8;
    width = Math.max(width, barW);
    if (legend.missing) {
      parts.push(swatch(x, rowY, legend.missing));
      parts.push(text("legend", x + SWATCH + 6, rowY + SWATCH - 2, "Missing"));
      rowY += LEGEND_ROW;
    }
  }
  return { svg: `<g class="legend">${parts.join("")}</g>`, width, height: rowY - y };
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toPrecision(4).replace(/\.?0+$/, "");
}

export function lerpHex(a: string, b: string, t: number): string {
  const parse = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const [p, q] = [parse(a), parse(b)];
  return "#" + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

/** Colors a continuous trait is drawn with: the user's choice or the trait's own. */
export interface TraitColors { low: string; high: string; missing: string }

export const DEFAULT_MISSING_COLOR = "#6B7280";

export function traitColorsFor(meta: TraitMeta, custom?: Partial<TraitColors>): TraitColors {
  return {
    low:     custom?.low     ?? meta.color_low,
    high:    custom?.high    ?? meta.color_high,
    missing: custom?.missing ?? DEFAULT_MISSING_COLOR,
  };
}

/**
 * The legend for the active trait over the displayed individuals. Discrete
 * entries take their color from the chart's own color map, so the legend
 * always matches the nodes.
 */
export function buildLegend(
  meta: TraitMeta | undefined, individuals: GraphNode[],
  colorMap: Record<string, string>, colors?: TraitColors,
): Legend | null {
  if (!meta) return null;
  const missing = individuals.filter(n => n.traits?.[meta.name] == null);
  if (meta.type === "continuous") {
    const c = colors ?? traitColorsFor(meta);
    return { trait: meta.name, kind: "continuous", min: meta.min, max: meta.max,
             low: c.low, high: c.high, missing: missing.length ? c.missing : null };
  }
  const byValue = new Map<string, string>();
  for (const n of individuals) {
    const v = n.traits?.[meta.name];
    if (v != null && colorMap[n.id] && !byValue.has(String(v))) byValue.set(String(v), colorMap[n.id]);
  }
  const order = (v: string) => { const i = meta.categories.indexOf(v); return i < 0 ? Infinity : i; };
  const entries = [...byValue].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([label, color]) => ({ label, color }));
  if (missing.length && colorMap[missing[0].id]) entries.push({ label: "Missing", color: colorMap[missing[0].id] });
  return { trait: meta.name, kind: "discrete", entries };
}
