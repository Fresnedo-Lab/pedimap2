// chart/svgExport.ts
// ==================
// Build a standalone SVG of the whole chart from node positions and the chart
// model (not a screenshot), reproducing the display style: node shape and
// fill, labels as real <text>, role-colored links, cross symbols, and the
// legends: the active coloring's, then the founder alleles' of the IBD bars,
// below a top-to-bottom chart and at the right of a left-to-right one. PDF and
// PNG export both start from this SVG.
//
// Links are written from chart/routing.ts, the routes the canvas draws, so
// they run exactly as on screen.

import type { GraphNode, TraitMeta } from "../hooks/useApi";
import { REMAINDER_COLOR, type BoxItem, type FounderLegend, type HaplotypeBox } from "../lib/haplotype";
import { linkColor, type ChartModel } from "./model";
import { chartBoxes, routeLinks, routingProblems, svgPathData, type Box, type Point } from "./routing";
import {
  CHART_FONT, SYMBOL_RADIUS, THEMES, labelInside, nodeLabelColor,
  type DisplayStyle, type NodeShape, type StyleTheme,
} from "./style";

export type { Box, Point };

/** Page behind the chart: white (for print) or the style's own background. */
export type ExportBackground = "white" | "screen";

/** A legend entry; `hatch` draws its swatch hatched (see HATCH). */
export interface LegendEntry { label: string; color: string; hatch?: boolean }

/** Diagonal hatching on a mid-gray: the fill of an individual whose value is
 *  unknown where a value is expected (e.g. copies of an allele when one of its
 *  alleles is unknown), set apart from any solid color. */
// Light stripes on the gray, so that a label on it (black, see labelColorOn)
// stands out from both: 8.2:1 against the gray, 17:1 against the stripes.
export const HATCH = { fill: "#9CA3AF", ink: "#E5E7EB", spacing: 6, width: 2 };
const HATCH_ID = "unknown-hatch";
const hatchPattern = () =>
  `<pattern id="${HATCH_ID}" patternUnits="userSpaceOnUse" width="${HATCH.spacing}" ` +
  `height="${HATCH.spacing}" patternTransform="rotate(45)">` +
  `<rect width="${HATCH.spacing}" height="${HATCH.spacing}" fill="${HATCH.fill}"/>` +
  `<rect width="${HATCH.width}" height="${HATCH.spacing}" fill="${HATCH.ink}"/></pattern>`;
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
  /** Individuals drawn hatched (HATCH) instead of with their color. */
  hatched?:        string[];
  /** Haplotype boxes (lib/haplotype.ts), drawn in place of the node shapes:
   *  the same items the canvas draws. */
  haplotypeBoxes?: Record<string, HaplotypeBox> | null;
  style:           DisplayStyle;
  orientation:     "UD" | "LR";
  crossSymbolSize: number;
  legend?:         Legend | null;
  /** The founder alleles of the IBD bars (lib/haplotype.ts, founderAlleleLegend). */
  founderLegend?:  FounderLegend | null;
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
/** Between the coloring's legend and the founder alleles' legend. */
const BLOCK_GAP = 16;
/** Founder rows per column of a legend at the right of the chart (design §7). */
const LEGEND_COLUMN_ROWS = 20;
const COLUMN_GAP = 24;
const ALLELE_GAP = 10;
/** Width per character of legend text that other items follow: wider than
 *  textWidth's average, since founder names are often capitals and
 *  underscores (DUMMY_G1_007_M), which run wider in the chart font. */
const LEGEND_CHAR = 0.72;

/** Default classic box size; vis-network grows it to fit the label. */
export const CLASSIC_BOX = { minWidth: 80, minHeight: 30, padding: 5 };

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/** Rough text width when no canvas is available to measure it. */
export function textWidth(text: string, fontSize: number): number {
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

/**
 * The individuals' boxes and the link routes an export draws: the canvas's
 * own boxes and routes, or, without a canvas, boxes estimated from labels.
 */
export function exportRouting(input: Pick<SvgExportInput,
  "model" | "positions" | "boxes" | "style" | "orientation" | "crossSymbolSize" | "haplotypeBoxes">) {
  const { model, positions, orientation, crossSymbolSize } = input;
  const theme = THEMES[input.style];
  const boxes: Record<string, Box> = {};
  for (const n of model.individuals) {
    const p = positions[n.id];
    const hb = input.haplotypeBoxes?.[n.id];
    if (p) boxes[n.id] = input.boxes?.[n.id] ?? (hb ? haplotypeRect(hb, p) : estimateBox(n, p, theme));
  }
  const routes = routeLinks(model, positions, boxes, {
    orientation, curved: theme.curvedLinks, arrows: theme.arrows, crossSymbolSize,
  });
  return { boxes, routes, problems: routingProblems(model, routes) };
}

/** A haplotype box's rectangle, centered on its node. */
export function haplotypeRect(box: HaplotypeBox, p: Point): Box {
  return { left: p.x - box.width / 2, right: p.x + box.width / 2,
           top: p.y - box.height / 2, bottom: p.y + box.height / 2 };
}

/** One haplotype box as SVG, its top left corner at (left, top). */
function haplotypeSvg(box: HaplotypeBox, left: number, top: number, radius: number, hatched: boolean): string {
  const item = (i: BoxItem): string => {
    switch (i.role) {
      case "box":
        return `<rect class="haplotype-box" x="0" y="0" width="${fmt(i.w)}" height="${fmt(i.h)}" ` +
          `rx="${radius}" fill="${hatched ? `url(#${HATCH_ID})` : i.fill}" stroke="${i.stroke}" stroke-width="1"/>`;
      case "segment":
        return `<rect class="segment" x="${fmt(i.x)}" y="${fmt(i.y)}" width="${fmt(i.w)}" ` +
          `height="${fmt(i.h)}" fill="${i.fill}"/>`;
      case "no-data":
        return `<rect class="no-data" x="${fmt(i.x)}" y="${fmt(i.y)}" width="${fmt(i.w)}" ` +
          `height="${fmt(i.h)}" fill="url(#${HATCH_ID})"/>`;
      case "bar":
        return `<rect class="bar" x="${fmt(i.x)}" y="${fmt(i.y)}" width="${fmt(i.w)}" height="${fmt(i.h)}" ` +
          `fill="none" stroke="${i.stroke}" stroke-width="1"/>`;
      case "position-tick":
      case "marker-tick":
        return `<line class="${i.role}" x1="${fmt(i.x1)}" y1="${fmt(i.y1)}" x2="${fmt(i.x2)}" ` +
          `y2="${fmt(i.y2)}" stroke="${i.stroke}" stroke-width="${i.role === "position-tick" ? 1 : 0.75}"/>`;
      case "name":
        return `<text class="individual" x="${fmt(i.x)}" y="${fmt(i.y)}" text-anchor="middle" ` +
          `font-size="${i.fontSize}" fill="${i.color}">${escapeXml(i.text)}</text>`;
    }
  };
  return `<g class="node haplotype" transform="translate(${fmt(left)},${fmt(top)})">` +
    box.items.map(item).join("") + `</g>`;
}

export function buildSvg(input: SvgExportInput): SvgExport {
  const { model, positions, colorMap, crossSymbolSize, legend, founderLegend } = input;
  const theme = THEMES[input.style];
  const hatched = new Set(input.hatched ?? []);
  const usesHatch = hatched.size > 0 ||
    (legend?.kind === "discrete" && legend.entries.some(e => e.hatch)) ||
    !!founderLegend?.noData ||
    Object.values(input.haplotypeBoxes ?? {}).some(b => b.items.some(i => i.role === "no-data"));
  const shapeOf = new Map(model.individuals.map(n => [n.id, theme.shape(n.cross_type)]));

  // ── Geometry ──────────────────────────────────────────────────────────────
  const { boxes, routes } = exportRouting(input);
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

  // ── Legends ───────────────────────────────────────────────────────────────
  // One block, the coloring's legend first: below a top-to-bottom chart (its
  // columns as wide as the chart), at the right of a left-to-right one. The
  // page grows to hold it, so it never overlaps the chart.
  const below = input.orientation === "UD";
  const blocks = [
    legend ? renderLegend(legend, theme, pageText) : null,
    founderLegend ? renderFounderLegend(founderLegend, theme, pageText, below ? chartW : null) : null,
  ].filter((b): b is Block => b !== null);
  const legendW = Math.max(0, ...blocks.map(b => b.width));
  const legendH = blocks.reduce((h, b) => h + b.height, 0) + BLOCK_GAP * Math.max(0, blocks.length - 1);
  const legendX = below ? MARGIN : MARGIN + chartW + LEGEND_GAP;
  const legendY = below ? MARGIN + chartH + LEGEND_GAP : MARGIN;
  let blockY = legendY;
  const legendSvg = blocks.map(b => {
    const g = `<g class="${b.cls}" transform="translate(${fmt(legendX)},${fmt(blockY)})">${b.svg}</g>`;
    blockY += b.height + BLOCK_GAP;
    return g;
  }).join("\n");
  const width  = MARGIN * 2 + (!blocks.length ? chartW : below ? Math.max(chartW, legendW) : chartW + LEGEND_GAP + legendW);
  const height = MARGIN * 2 + (!blocks.length ? chartH : below ? chartH + LEGEND_GAP + legendH : Math.max(chartH, legendH));

  // ── Links: the canvas's routes, in chart coordinates ──────────────────────
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
    const hb = input.haplotypeBoxes?.[n.id];
    if (hb) return haplotypeSvg(hb, box.left, box.top, input.style === "classic" ? 0 : 4, hatched.has(n.id));
    const shape = shapeOf.get(n.id)!;
    const fill = hatched.has(n.id) ? `url(#${HATCH_ID})` : colorMap[n.id] ?? theme.defaultFill;
    let ty: number;
    if (shape === "box") ty = box.top + CLASSIC_BOX.padding + theme.fontSize * 0.9;  // name on top
    else if (shape === "ellipse") ty = p.y + theme.fontSize * 0.35;
    else ty = p.y + SYMBOL_RADIUS + 4 + theme.fontSize * 0.9;                        // below the symbol
    // A label inside the shape takes black or white by its fill (WCAG AA).
    const color = nodeLabelColor(shape, hatched.has(n.id) ? HATCH.fill : fill, pageText);
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
    `<defs>${fontFace}${usesHatch ? hatchPattern() : ""}</defs>`,
    `<rect class="background" x="0" y="0" width="${fmt(width)}" height="${fmt(height)}" fill="${background}"/>`,
    `<g class="links" transform="translate(${fmt(ox)},${fmt(oy)})">${links}</g>`,
    `<g class="crosses">${crossesSvg}</g>`,
    `<g class="nodes">${nodesSvg}</g>`,
    legendSvg,
    `</svg>`,
  ].join("\n");
  return { svg, width, height };
}

// ── Legend ───────────────────────────────────────────────────────────────────

/** A legend drawn at (0, 0), and its size. */
interface Block { cls: string; svg: string; width: number; height: number }

const legendText = (textColor: string) => (cls: string, tx: number, ty: number, s: string, extra = "") =>
  `<text class="${cls}" x="${fmt(tx)}" y="${fmt(ty)}" fill="${textColor}"${extra}>${escapeXml(s)}</text>`;
const legendSwatch = (theme: StyleTheme) => (sx: number, sy: number, color: string, hatch = false, extra = "") =>
  `<rect class="legend-swatch" x="${fmt(sx)}" y="${fmt(sy)}" width="${SWATCH}" height="${SWATCH}" ` +
  `fill="${hatch ? `url(#${HATCH_ID})` : color}" stroke="${theme.border}" stroke-width="0.5"${extra}/>`;

function renderLegend(legend: Legend, theme: StyleTheme, textColor: string): Block {
  const x = 0, y = 0;
  const text = legendText(textColor);
  const swatch = legendSwatch(theme);

  // Regular weight only (see svgToPdf); the title is set apart by size.
  const parts = [text("legend-title", x, y + theme.fontSize, legend.trait, ` font-size="${theme.fontSize + 2}"`)];
  let rowY = y + theme.fontSize + 10;
  let width = textWidth(legend.trait, theme.fontSize);

  if (legend.kind === "discrete") {
    for (const e of legend.entries) {
      parts.push(swatch(x, rowY, e.color, e.hatch));
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
  return { cls: "legend", svg: parts.join(""), width, height: rowY - y };
}

/**
 * The founder alleles of the IBD bars (design §7): a row per founder, its name
 * and a numbered swatch for each of its alleles drawn; then the gray remainder
 * and "No IBD data" when drawn. Rows flow into columns: at most
 * LEGEND_COLUMN_ROWS per column at the right of the chart, or as many columns
 * as fit `maxWidth` below it.
 */
function renderFounderLegend(legend: FounderLegend, theme: StyleTheme, textColor: string,
                             maxWidth: number | null): Block {
  const fs = theme.fontSize;
  const text = legendText(textColor);
  const swatch = legendSwatch(theme);
  const width_ = (s: string, size = fs) => [...s].length * size * LEGEND_CHAR;
  const labelW = (r: FounderLegend["rows"][number]) => width_(r.label);
  const swatchesW = (r: FounderLegend["rows"][number]) =>
    r.alleles.reduce((w, a) => w + SWATCH + 4 + width_(String(a.allele)), 0) +
    ALLELE_GAP * Math.max(0, r.alleles.length - 1);
  const n = legend.rows.length;
  const layout = (columns: number) => {
    const perColumn = Math.max(1, Math.ceil(n / columns));
    const cols = Array.from({ length: Math.ceil(n / perColumn) }, (_, c) => legend.rows.slice(c * perColumn, (c + 1) * perColumn));
    const label = cols.map(col => Math.max(0, ...col.map(labelW)));
    const widths = cols.map((col, c) => label[c] + 8 + Math.max(0, ...col.map(swatchesW)));
    return { perColumn, cols, label, widths, total: widths.reduce((a, b) => a + b, 0) + COLUMN_GAP * Math.max(0, cols.length - 1) };
  };
  let grid = layout(Math.max(1, Math.ceil(n / LEGEND_COLUMN_ROWS)));
  if (maxWidth !== null) {
    grid = layout(1);
    for (let c = n; c > 1; c--) {
      const g = layout(c);
      if (g.total <= maxWidth) { grid = g; break; }
    }
  }

  const titleSize = fs + 2;
  const parts = [text("legend-title", 0, titleSize, legend.title, ` font-size="${titleSize}"`)];
  const top = titleSize + 10;
  let colX = 0;
  grid.cols.forEach((col, c) => {
    col.forEach((row, i) => {
      const y = top + i * LEGEND_ROW;
      let x = colX + grid.label[c] + 8;
      const cells = [text("legend founder", colX, y + SWATCH - 2, row.label)];
      for (const a of row.alleles) {
        cells.push(swatch(x, y, a.color, false, ` data-allele="${a.allele}"`));
        cells.push(text("legend allele", x + SWATCH + 4, y + SWATCH - 2, String(a.allele)));
        x += SWATCH + 4 + width_(String(a.allele)) + ALLELE_GAP;
      }
      parts.push(`<g class="legend-row" data-founder="${escapeXml(row.label)}">${cells.join("")}</g>`);
    });
    colX += grid.widths[c] + COLUMN_GAP;
  });
  let rowY = top + Math.min(n, grid.perColumn) * LEGEND_ROW;
  let width = Math.max(width_(legend.title, titleSize), grid.total);
  const extra = (label: string, color: string, hatch: boolean, cls: string) => {
    parts.push(`<g class="${cls}">${swatch(0, rowY, color, hatch)}` +
               `${text("legend", SWATCH + 6, rowY + SWATCH - 2, label)}</g>`);
    width = Math.max(width, SWATCH + 6 + width_(label));
    rowY += LEGEND_ROW;
  };
  if (legend.remainder) extra(legend.remainder, REMAINDER_COLOR, false, "legend-remainder");
  if (legend.noData) extra("No IBD data", HATCH.fill, true, "legend-no-data");
  return { cls: "legend founder-alleles", svg: parts.join(""), width, height: rowY };
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
