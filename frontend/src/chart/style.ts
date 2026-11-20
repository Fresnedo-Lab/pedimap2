// chart/style.ts
// ==============
// The two display styles. Both the vis-network canvas and the SVG/PDF/PNG
// export read these values, so an exported image matches the screen.

export type DisplayStyle = "modern" | "classic";

export type NodeShape =
  | "box" | "ellipse" | "diamond" | "star" | "square" | "triangle" | "hexagon";

export interface StyleTheme {
  background:  string;
  /** Node fill when no trait coloring is active. */
  defaultFill: string;
  border:      string;
  /** Border of the selected individual (on screen only). */
  selected:    string;
  text:        string;
  /** Text on a white export page (labels under symbols, legend). */
  paperText:   string;
  /** Color of the cross → child link and of the × itself. */
  ink:         string;
  fontFace:    string;
  fontSize:    number;
  arrows:      boolean;
  curvedLinks: boolean;
  shape:       (crossType: string) => NodeShape;
}

// Bundled with the app (src/assets/fonts) and embedded in exports, so accented
// and non-Latin-1 names render the same everywhere.
export const CHART_FONT = "Noto Sans";

// Modern: node shape by cross type (unchanged from earlier releases).
const MODERN_SHAPE: Record<string, NodeShape> = {
  cross:     "ellipse",
  self:      "diamond",
  dh:        "star",
  clone:     "square",
  backcross: "triangle",
  op:        "hexagon",
  unknown:   "ellipse",
};

export const THEMES: Record<DisplayStyle, StyleTheme> = {
  modern: {
    background:  "#0f1117",
    defaultFill: "#252e42",
    border:      "#4f9cf9",
    selected:    "#ffffff",
    text:        "#e8ecf4",
    paperText:   "#1F2937",
    ink:         "#8a94a8",
    fontFace:    `${CHART_FONT}, Inter, sans-serif`,
    fontSize:    11,
    arrows:      true,
    curvedLinks: true,
    shape:       ct => MODERN_SHAPE[ct] ?? "ellipse",
  },
  // Classic Pedimap: name at the top of a rectangle, pale yellow fill
  // (Pedimap 1.x's default individual background) on a white page.
  classic: {
    background:  "#FFFFFF",
    defaultFill: "#FFFF96",
    border:      "#000000",
    selected:    "#F59E0B",
    text:        "#000000",
    paperText:   "#000000",
    ink:         "#000000",
    fontFace:    `${CHART_FONT}, sans-serif`,
    fontSize:    12,
    arrows:      false,
    curvedLinks: false,
    shape:       () => "box",
  },
};

/** Shapes vis-network draws with the label inside; the others put it below. */
export function labelInside(shape: NodeShape): boolean {
  return shape === "box" || shape === "ellipse";
}

/** Radius of the shapes that carry their label below. */
export const SYMBOL_RADIUS = 18;

// ── Label contrast ───────────────────────────────────────────────────────────

/** WCAG 2 relative luminance of a #RRGGBB color. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio of two #RRGGBB colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const DARK_LABEL = "#000000";
export const LIGHT_LABEL = "#FFFFFF";

/** The color of a label drawn on `fill`: black or white, whichever contrasts
 *  more. One of the two always reaches 4.58:1 (at the luminance where they
 *  are equal), so every fill meets WCAG AA's 4.5:1 for normal text. */
export function labelColorOn(fill: string): string {
  return contrastRatio(DARK_LABEL, fill) >= contrastRatio(LIGHT_LABEL, fill) ? DARK_LABEL : LIGHT_LABEL;
}

/** A node's label color: from its fill when the label is inside the shape,
 *  else the color of text on the page it sits on. */
export function nodeLabelColor(shape: NodeShape, fill: string, pageText: string): string {
  return labelInside(shape) ? labelColorOn(fill) : pageText;
}
