// chart/svgExport.ts
// ==================
// Build a standalone SVG of the whole chart from node positions and the chart
// model (not a screenshot), reproducing the display style: node shape and
// fill, labels as real <text>, role-colored links, cross symbols, and the
// legend of the active trait. PDF and PNG export both start from this SVG.
//
// Links are written from chart/routing.ts, the routes the canvas draws, so
// they run exactly as on screen.

import type { GraphNode, TraitMeta } from "../hooks/useApi";
import { linkColor, type ChartModel } from "./model";
import { chartBoxes, routeLinks, svgPathData, type Box, type Point } from "./routing";
import {
  CHART_FONT, SYMBOL_RADIUS, THEMES, labelInside,
  type DisplayStyle, type NodeShape, type StyleTheme,
} from "./style";

export type { Box, Point };

/** Page behind the chart: white (for print) or the style's own background. */
export type ExportBackground = "white" | "screen";

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
  /** Default "white". */
  background?:     ExportBackground;
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
  const boxes: Record<string, Box> = {};
  for (const n of model.individuals) {
    const p = positions[n.id];
    if (p) boxes[n.id] = input.boxes?.[n.id] ?? estimateBox(n, p, theme);
  }
  const all = [...chartBoxes(model, positions, boxes, crossSymbolSize).values()];
  const minX = Math.min(...all.map(b => b.left)), maxX = Math.max(...all.map(b => b.right));
  const minY = Math.min(...all.map(b => b.top)),  maxY = Math.max(...all.map(b => b.bottom));
  const ox = MARGIN - (all.length ? minX : 0), oy = MARGIN - (all.length ? minY : 0);
  const chartW = all.length ? maxX - minX : 0, chartH = all.length ? maxY - minY : 0;

  const at = (p: Point): Point => ({ x: p.x + ox, y: p.y + oy });
  const shift = (b: Box): Box => ({ left: b.left + ox, right: b.right + ox, top: b.top + oy, bottom: b.bottom + oy });

  // On a white page, text that sits on the page rather than in a node (labels
  // under symbols, the legend) takes the style's dark print color.
  const paper = (input.background ?? "white") === "white";
  const background = paper ? "#FFFFFF" : theme.background;
  const pageText = paper ? theme.paperText : theme.text;

  // ── Legend ────────────────────────────────────────────────────────────────
  const legendSvg = legend ? renderLegend(legend, theme, pageText, MARGIN + chartW + LEGEND_GAP, MARGIN) : null;
  const width  = MARGIN * 2 + chartW + (legendSvg ? LEGEND_GAP + legendSvg.width : 0);
  const height = MARGIN * 2 + Math.max(chartH, legendSvg?.height ?? 0);

  // ── Links: the canvas's routes, in chart coordinates ──────────────────────
  const routes = routeLinks(model, positions, boxes, {
    orientation, curved: theme.curvedLinks, arrows: theme.arrows, crossSymbolSize,
  });
  const links = routes.map(r => {
    const color = linkColor(r.role, theme.ink);
    const arrow = r.arrow
      ? `<polygon class="arrow" points="${r.arrow.map(q => `${fmt(q.x)},${fmt(q.y)}`).join(" ")}" fill="${color}"/>`
      : "";
    return `<path class="link link-${r.role}" d="${svgPathData(r)}" fill="none" stroke="${color}" ` +
      `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>${arrow}`;
  }).join("\n");

  // ── Nodes ─────────────────────────────────────────────────────────────────
  const crossesSvg = model.crosses
    .filter(c => positions[c.id])
    .map(c => crossSvg(at(positions[c.id]), crossSymbolSize, theme.ink)).join("\n");

  const nodesSvg = model.individuals.filter(n => positions[n.id]).map(n => {
    const p = at(positions[n.id]);
    const box = shift(boxes[n.id]);
    const shape = shapeOf.get(n.id)!;
    const fill = colorMap[n.id] ?? theme.defaultFill;
    let ty: number;
    if (shape === "box") ty = box.top + CLASSIC_BOX.padding + theme.fontSize * 0.9;  // name on top
    else if (shape === "ellipse") ty = p.y + theme.fontSize * 0.35;
    else ty = p.y + SYMBOL_RADIUS + 4 + theme.fontSize * 0.9;                        // below the symbol
    const color = labelInside(shape) ? theme.text : pageText;
    return `<g class="node">${shapeSvg(shape, p, box, fill, theme.border)}` +
      `<text class="individual" x="${fmt(p.x)}" y="${fmt(ty)}" text-anchor="middle" ` +
      `fill="${color}">${escapeXml(n.label)}</text></g>`;
  }).join("\n");

  // ── Document ──────────────────────────────────────────────────────────────
  const fontFace = input.fontBase64
    ? `<style>@font-face{font-family:"${CHART_FONT}";` +
      `src:url(data:font/ttf;base64,${input.fontBase64}) format("truetype");}</style>`
    : "";

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}" height="${fmt(height)}" ` +
      `viewBox="0 0 ${fmt(width)} ${fmt(height)}" font-family="${CHART_FONT}, sans-serif" ` +
      `font-size="${theme.fontSize}">`,
    `<defs>${fontFace}</defs>`,
    `<rect class="background" x="0" y="0" width="${fmt(width)}" height="${fmt(height)}" fill="${background}"/>`,
    `<g class="links" transform="translate(${fmt(ox)},${fmt(oy)})">${links}</g>`,
    `<g class="crosses">${crossesSvg}</g>`,
    `<g class="nodes">${nodesSvg}</g>`,
    legendSvg ? legendSvg.svg : "",
    `</svg>`,
  ].join("\n");
  return { svg, width, height };
}

// ── Legend ───────────────────────────────────────────────────────────────────

function renderLegend(legend: Legend, theme: StyleTheme, textColor: string, x: number, y: number) {
  const text = (cls: string, tx: number, ty: number, s: string, extra = "") =>
    `<text class="${cls}" x="${fmt(tx)}" y="${fmt(ty)}" fill="${textColor}"${extra}>${escapeXml(s)}</text>`;
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
