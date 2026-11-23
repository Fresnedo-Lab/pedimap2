// lib/haplotype.ts
// ================
// The haplotype display's data, palettes and box geometry, as pure functions
// shared by the canvas and the image export (docs/design/haplotype-display.md).

import { oklch } from "./colorScience";
import { ALLELE_COLORS, FOUNDER_PAIRS_LARGE, FOUNDER_PAIRS_SMALL } from "./palettes";
import { labelColorOn, type StyleTheme } from "../chart/style";

// ── Data (GET /api/haplotypes) ───────────────────────────────────────────────

/** [founder allele (1-based), probability]: a nonzero entry of a homologue. */
export type AlleleProbability = [number, number];

export interface HaplotypeData {
  linkage_group:   string;
  start_cM:        number;
  end_cM:          number;
  positions:       { position: string; cM: number }[];
  markers:         { name: string; cM: number; position: string | null }[];
  nalleles:        number;
  /** The founder behind founder alleles 2k+1 and 2k+2 (index k); null when
   *  the file does not name them (an exported subset). */
  founders:        string[] | null;
  founder_alleles: Record<string, (string | null)[]>;
  /** rows[individual][homologue][position index]: the nonzero entries. */
  rows:            Record<string, AlleleProbability[][][]>;
}

// ── Bands ────────────────────────────────────────────────────────────────────

export interface Band { index: number; position: string; cM: number; from: number; to: number }

/** Each IBD position owns the stretch of the map between the midpoints with
 *  its neighbors; the first and last reach the map's ends (design §1.1). */
export function bands(data: HaplotypeData): Band[] {
  const ps = data.positions;
  return ps.map((p, i) => ({
    index: i, position: p.position, cM: p.cM,
    from: i === 0 ? data.start_cM : (ps[i - 1].cM + p.cM) / 2,
    to: i === ps.length - 1 ? data.end_cM : (p.cM + ps[i + 1].cM) / 2,
  }));
}

// ── Segments ─────────────────────────────────────────────────────────────────

export interface Segment {
  /** Founder allele, or null for the remainder of merged narrow segments. */
  allele:      number | null;
  /** The probability as read (for a remainder, the merged ones' sum). */
  probability: number;
  /** Share of the bar's width: probability over the homologue's sum. */
  share:       number;
  /** For a remainder, the merged entries. */
  merged?:     AlleleProbability[];
}

/** The segments of one band of one homologue, in founder-allele order, with
 *  those narrower than `minWidth` (in px of a bar `barWidth` wide) merged into
 *  a remainder at the end. Shares are scaled to sum to 1 for drawing (FlexQTL
 *  rounds each value, so its sums are 0.98-1.02); probabilities stay as read. */
export function segments(entries: AlleleProbability[], barWidth: number, minWidth = 1): Segment[] {
  const total = entries.reduce((s, [, p]) => s + p, 0);
  if (total <= 0) return [];
  const sorted = [...entries].sort((a, b) => a[0] - b[0]);
  const wide: Segment[] = [];
  const narrow: AlleleProbability[] = [];
  for (const [allele, p] of sorted) {
    if ((p / total) * barWidth < minWidth) narrow.push([allele, p]);
    else wide.push({ allele, probability: p, share: p / total });
  }
  if (narrow.length) {
    const p = narrow.reduce((s, [, q]) => s + q, 0);
    wide.push({ allele: null, probability: p, share: p / total, merged: narrow });
  }
  return wide;
}

// ── Contributing founders ────────────────────────────────────────────────────

/** The founder alleles with a nonzero probability, at some position of the
 *  group, in the rows of the individuals `ids`, ascending. */
export function contributingAlleles(data: HaplotypeData, ids: Iterable<string>): number[] {
  const found = new Set<number>();
  for (const id of ids) {
    for (const homologue of data.rows[id] ?? []) {
      for (const band of homologue) for (const [allele] of band) found.add(allele);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** Founder index (0-based) of a founder allele (1-based), two per founder. */
export const founderOf = (allele: number) => Math.floor((allele - 1) / 2);

/** The founders (indices) that contribute to the individuals `ids`, ascending. */
export function contributingFounders(data: HaplotypeData, ids: Iterable<string>): number[] {
  return [...new Set(contributingAlleles(data, ids).map(founderOf))].sort((a, b) => a - b);
}

// ── Palettes ─────────────────────────────────────────────────────────────────

export type ColorScheme = "founder" | "allele" | "highlight";

export interface LegendRow { label: string; swatches: { allele: number | null; color: string }[] }

export interface Palette {
  scheme:   ColorScheme;
  colorOf:  (allele: number) => string;
  /** Exactly the contributing founders (or founder alleles), design §2.2. */
  legend:   LegendRow[];
}

/** Fill of a remainder of merged narrow segments: a dark neutral gray, far
 *  from every palette color and from the light grays of the hatch and of the
 *  highlight scheme (palettes.test.ts). */
export const REMAINDER_COLOR = "#4B5563";
/** Fill of a founder allele that is not highlighted. */
export const NOT_HIGHLIGHTED = "#E5E7EB";
/** Okabe & Ito's colors for color-blind viewers, for highlighted alleles. */
export const HIGHLIGHT_COLORS = ["#E69F00", "#56B4E9", "#009E73", "#F0E442",
                                 "#0072B2", "#D55E00", "#CC79A7", "#000000"];
export const MAX_HIGHLIGHTED = HIGHLIGHT_COLORS.length;

/** Up to this many contributing founders, founders take the greedy sequence
 *  (its first colors the most separated); beyond, the sequence refined for
 *  many founders at once, which then separates them better (palettes.ts). */
export const SMALL_PALETTE_FOUNDERS = 22;

// Beyond the stored palettes (more than 30 founders or 60 founder alleles),
// colors continue around the hue circle by the golden angle; telling them apart
// then relies on the legend, the hover and the highlight scheme.
const GOLDEN_ANGLE = 137.508;
const extraPair = (r: number): [string, string] => {
  const hue = (25 + r * GOLDEN_ANGLE) % 360, [light, dark] = r % 2 ? [0.72, 0.50] : [0.84, 0.60];
  return [oklch(light, 0.12, hue), oklch(dark, 0.12, hue)];
};
const extraAllele = (q: number) => oklch([0.82, 0.66, 0.50][q % 3], 0.12, (25 + q * GOLDEN_ANGLE) % 360);

/** The shades of the founder of rank `r` among `n` contributing founders. */
export function founderShades(r: number, n: number): [string, string] {
  const pairs = n <= SMALL_PALETTE_FOUNDERS ? FOUNDER_PAIRS_SMALL : FOUNDER_PAIRS_LARGE;
  return pairs[r] ?? extraPair(r);
}

const founderLabel = (data: HaplotypeData, k: number) =>
  data.founders?.[k] ?? `Founder alleles ${2 * k + 1}–${2 * k + 2}`;

/** The founder-allele colors for the individuals `ids`, over the contributing
 *  founders only, and the legend that lists exactly them. */
export function palette(data: HaplotypeData, ids: Iterable<string>, scheme: ColorScheme,
                        highlighted: number[] = []): Palette {
  const colors = new Map<number, string>();
  const legend: LegendRow[] = [];
  if (scheme === "founder") {
    const founders = contributingFounders(data, ids);
    founders.forEach((k, r) => {
      const pair = founderShades(r, founders.length);
      colors.set(2 * k + 1, pair[0]);
      colors.set(2 * k + 2, pair[1]);
      legend.push({ label: founderLabel(data, k),
                    swatches: [{ allele: 2 * k + 1, color: pair[0] }, { allele: 2 * k + 2, color: pair[1] }] });
    });
  } else if (scheme === "allele") {
    contributingAlleles(data, ids).forEach((a, q) => {
      const color = ALLELE_COLORS[q] ?? extraAllele(q);
      colors.set(a, color);
      const k = founderOf(a);
      legend.push({ label: data.founders ? `${data.founders[k]}, founder allele ${a}` : `Founder allele ${a}`,
                    swatches: [{ allele: a, color }] });
    });
  } else {
    const present = new Set(contributingAlleles(data, ids));
    highlighted.filter(a => present.has(a)).slice(0, MAX_HIGHLIGHTED).forEach((a, i) => {
      colors.set(a, HIGHLIGHT_COLORS[i]);
      const k = founderOf(a);
      legend.push({ label: data.founders ? `${data.founders[k]}, founder allele ${a}` : `Founder allele ${a}`,
                    swatches: [{ allele: a, color: HIGHLIGHT_COLORS[i] }] });
    });
    if (present.size > legend.length) {
      legend.push({ label: "Other founder alleles", swatches: [{ allele: null, color: NOT_HIGHLIGHTED }] });
    }
  }
  const fallback = scheme === "highlight" ? NOT_HIGHLIGHTED : REMAINDER_COLOR;
  return { scheme, colorOf: a => colors.get(a) ?? fallback, legend };
}

// ── Box geometry ─────────────────────────────────────────────────────────────

export interface HaplotypeSettings { barWidth: number; barHeight: number; markerTicks: boolean }
export const DEFAULT_HAPLOTYPE_SETTINGS: HaplotypeSettings = { barWidth: 10, barHeight: 90, markerTicks: true };

/** Probabilities below this share of a homologue are drawn as one gray
 *  remainder: a segment narrower than BOX.minSegment px of the bar (§1.1). */
export const mergeThreshold = (settings: HaplotypeSettings) => BOX.minSegment / settings.barWidth;

export type BoxItem =
  | { kind: "rect"; role: "box"; x: number; y: number; w: number; h: number; fill: string; stroke: string }
  | { kind: "rect"; role: "bar"; x: number; y: number; w: number; h: number; stroke: string; homologue: number }
  | { kind: "rect"; role: "segment"; x: number; y: number; w: number; h: number; fill: string;
      homologue: number; band: number; segment: Segment }
  | { kind: "rect"; role: "no-data"; x: number; y: number; w: number; h: number; homologue: number }
  | { kind: "line"; role: "position-tick" | "marker-tick"; x1: number; y1: number; x2: number; y2: number;
      stroke: string }
  | { kind: "text"; role: "name"; x: number; y: number; text: string; color: string; fontSize: number };

export interface HaplotypeBox { width: number; height: number; items: BoxItem[] }

export const BOX = { padding: 6, gap: 6, tick: 4, minWidth: 60, nameGap: 4, minSegment: 1 };

/**
 * Everything inside one individual's box, in box coordinates (origin at the
 * box's top left). `homologues` are its rows on the group (null: none, the
 * bars are hatched as unknown, like any unknown value). Text widths come from `textWidth`, the same estimate the
 * canvas and the export use, so both draw the same box.
 */
export function haplotypeBox(input: {
  name:        string;
  fill:        string;
  theme:       StyleTheme;
  data:        HaplotypeData;
  homologues:  AlleleProbability[][][] | null;
  colorOf:     (allele: number) => string;
  settings:    HaplotypeSettings;
  textWidth:   (text: string, fontSize: number) => number;
}): HaplotypeBox {
  const { name, fill, theme, data, homologues, colorOf, settings, textWidth } = input;
  const { barWidth, barHeight } = settings;
  const fontSize = theme.fontSize;
  const content = 2 * barWidth + BOX.gap + 2 * (BOX.tick + 2);
  const width = Math.max(BOX.minWidth, textWidth(name, fontSize) + 2 * BOX.padding, content + 2 * BOX.padding);
  const barsTop = BOX.padding + fontSize + BOX.nameGap;
  const height = barsTop + barHeight + BOX.padding;
  const left = [width / 2 - BOX.gap / 2 - barWidth, width / 2 + BOX.gap / 2];
  const span = data.end_cM - data.start_cM;
  const y = (cM: number) => barsTop + (span > 0 ? ((cM - data.start_cM) / span) * barHeight : 0);

  const items: BoxItem[] = [
    { kind: "rect", role: "box", x: 0, y: 0, w: width, h: height, fill, stroke: theme.border },
    { kind: "text", role: "name", x: width / 2, y: BOX.padding + fontSize * 0.85, text: name,
      color: labelColorOn(fill), fontSize },
  ];
  const all = bands(data);
  for (let h = 0; h < 2; h++) {
    if (!homologues) {
      items.push({ kind: "rect", role: "no-data", x: left[h], y: barsTop, w: barWidth, h: barHeight, homologue: h });
    }
    for (const band of homologues ? all : []) {
      const top = span > 0 ? y(band.from) : barsTop, bottom = span > 0 ? y(band.to) : barsTop + barHeight;
      let x = left[h];
      for (const segment of segments(homologues?.[h]?.[band.index] ?? [], barWidth, BOX.minSegment)) {
        const w = segment.share * barWidth;
        items.push({ kind: "rect", role: "segment", x, y: top, w, h: bottom - top,
                     fill: segment.allele === null ? REMAINDER_COLOR : colorOf(segment.allele),
                     homologue: h, band: band.index, segment });
        x += w;
      }
    }
    items.push({ kind: "rect", role: "bar", x: left[h], y: barsTop, w: barWidth, h: barHeight,
                 stroke: theme.border, homologue: h });
    // Ticks on the outer side: every IBD position, and (optionally) every marker
    // that is not one (a marker at an IBD position already has its tick).
    const outer = h === 0 ? left[0] : left[1] + barWidth;
    const out = h === 0 ? -1 : 1;
    for (const p of data.positions) {
      items.push({ kind: "line", role: "position-tick", x1: outer, y1: y(p.cM),
                   x2: outer + out * BOX.tick, y2: y(p.cM), stroke: theme.border });
    }
    if (settings.markerTicks) {
      for (const m of data.markers.filter(m => m.position === null)) {
        items.push({ kind: "line", role: "marker-tick", x1: outer + out * (BOX.tick + 1), y1: y(m.cM),
                     x2: outer + out * (BOX.tick + 2), y2: y(m.cM), stroke: theme.border });
      }
    }
  }
  return { width, height, items };
}

// ── Legend of founder alleles (export) ───────────────────────────────────────

export interface FounderLegendRow {
  founder: number;                                   // index in founder order
  label:   string;
  alleles: { allele: number; color: string }[];      // the founder's alleles drawn, ascending
}
export interface FounderLegend {
  title:     string;
  rows:      FounderLegendRow[];
  /** Label of the gray remainder row, when a remainder is drawn. */
  remainder: string | null;
  /** Some individual has no IBD rows (its bars are hatched). */
  noData:    boolean;
}

const formatShare = (x: number) => x.toFixed(2);

/**
 * The legend of an export with IBD bars (design §7): one row per founder whose
 * alleles are drawn in color in `boxes`, each allele with its swatch; the gray
 * remainder and "No IBD data" only when drawn. Colors are the boxes' own, so
 * they are the screen's palette.
 */
export function founderAlleleLegend(data: HaplotypeData, boxes: Iterable<HaplotypeBox>,
                                    settings: HaplotypeSettings): FounderLegend {
  const colors = new Map<number, string>();
  let remainder = false, noData = false;
  for (const box of boxes) {
    for (const item of box.items) {
      if (item.role === "no-data") noData = true;
      else if (item.role === "segment") {
        if (item.segment.allele === null) remainder = true;
        else colors.set(item.segment.allele, item.fill);
      }
    }
  }
  const rows = new Map<number, FounderLegendRow>();
  for (const allele of [...colors.keys()].sort((a, b) => a - b)) {
    const k = founderOf(allele);
    if (!rows.has(k)) rows.set(k, { founder: k, label: founderLabel(data, k), alleles: [] });
    rows.get(k)!.alleles.push({ allele, color: colors.get(allele)! });
  }
  const t = formatShare(mergeThreshold(settings));
  return {
    title: `Founder alleles, linkage group ${data.linkage_group} (below ${t} merged)`,
    rows: [...rows.values()],
    remainder: remainder ? `Below ${t}, merged` : null,
    noData,
  };
}

// ── Hover ────────────────────────────────────────────────────────────────────

export type SegmentItem = Extract<BoxItem, { role: "segment" }>;

/** The segment under a point in box coordinates, if any. */
export function segmentAt(box: HaplotypeBox, x: number, y: number): SegmentItem | null {
  for (const item of box.items) {
    if (item.role === "segment" && x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h) {
      return item;
    }
  }
  return null;
}

const probability = (p: number) => p.toFixed(2);

/** The hover text of a segment (design §9): where it is, which homologue,
 *  the founder allele, its founder and the probability as read. */
export function describeSegment(item: SegmentItem, data: HaplotypeData, columns: [string, string]): string {
  const position = data.positions[item.band];
  const where = `LG ${data.linkage_group}, ${position.position} cM · homologue from ${
    (columns[item.homologue] ?? `parent ${item.homologue + 1}`).toLowerCase()}`;
  const allele = (a: number) => {
    const founder = data.founders?.[founderOf(a)];
    return `founder allele ${a}${founder ? ` (${founder})` : ""}`;
  };
  const { segment } = item;
  if (segment.allele !== null) return `${where} · ${allele(segment.allele)} · ${probability(segment.probability)}`;
  const merged = (segment.merged ?? []).map(([a, p]) => `${allele(a)} ${probability(p)}`).join(", ");
  return `${where} · other founder alleles, ${probability(segment.probability)} in all: ${merged}`;
}

// ── Layout ───────────────────────────────────────────────────────────────────

/** The largest box of a chart, for the layout's spacing. */
export function largestBox(boxes: Iterable<HaplotypeBox>): { width: number; height: number } {
  let width = 0, height = 0;
  for (const b of boxes) { width = Math.max(width, b.width); height = Math.max(height, b.height); }
  return { width, height };
}
