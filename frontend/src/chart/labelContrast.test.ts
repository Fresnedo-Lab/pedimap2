// Labels inside a node take black or white by its fill so that every label
// meets WCAG AA (4.5:1): checked for every legend color of each coloring mode,
// and on the canvas and in the export, which draw the same label colors.
import { describe, expect, it } from "vitest";
import {
  CODE_INFO, COPY_COLORS, NO_GENOTYPE_COLOR, OTHER_CODE_COLOR, UNKNOWN_COPIES_COLOR, codeColor,
} from "../lib/genotypeCodes";
import { HATCH, buildSvg, lerpHex, traitColorsFor } from "./svgExport";
import { THEMES, contrastRatio, labelColorOn, nodeLabelColor } from "./style";
import { buildChartModel, gridLayout } from "./model";
import { individualColors } from "../components/PedigreeCanvas";
import type { GraphData, TraitMeta } from "../hooks/useApi";
import { appleColorS1S2 } from "../test/fixtures";

const AA = 4.5;

const continuous = (meta: Partial<TraitMeta>) => {
  const c = traitColorsFor({ name: "t", type: "continuous", min: 0, max: 1, categories: [],
                             color_low: "#3B82F6", color_high: "#EF4444", ...meta } as TraitMeta);
  return [...Array.from({ length: 21 }, (_, i) => lerpHex(c.low, c.high, i / 20)), c.missing];
};

/** Every fill a legend can show, by coloring mode. */
const MODES: Record<string, string[]> = {
  "genotype code": [...[...Array(13).keys(), 42].map(codeColor), OTHER_CODE_COLOR, NO_GENOTYPE_COLOR,
                    ...Object.keys(CODE_INFO).map(Number).map(codeColor)],
  "allele copies": [...COPY_COLORS, UNKNOWN_COPIES_COLOR, HATCH.fill, HATCH.ink, NO_GENOTYPE_COLOR],
  // A discrete trait's colors as the backend assigns them (apple_public.dat, S1_S2).
  "discrete trait": [...new Set(Object.values(appleColorS1S2))],
  "continuous trait": continuous({}),
  "no coloring": [THEMES.modern.defaultFill, THEMES.classic.defaultFill],
};

describe("label contrast", () => {
  for (const [mode, fills] of Object.entries(MODES)) {
    it(`meets 4.5:1 for every ${mode} legend color`, () => {
      expect(fills.length).toBeGreaterThan(1);
      for (const fill of fills) {
        const ratio = contrastRatio(labelColorOn(fill), fill);
        expect(ratio, `${labelColorOn(fill)} on ${fill}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(AA);
      }
    });
  }

  it("on a hatched fill, against both the gray and its stripes", () => {
    const label = labelColorOn(HATCH.fill);
    expect(contrastRatio(label, HATCH.fill)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(label, HATCH.ink)).toBeGreaterThanOrEqual(AA);
  });

  it("for any fill a user can choose", () => {
    for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 15) {
      const fill = "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
      expect(contrastRatio(labelColorOn(fill), fill)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("puts dark names on light fills and white names on dark fills, also when selected", () => {
    const node = { id: "A", label: "A", x: 0, y: 0, generation: 0, cross_type: "cross" };
    for (const style of ["modern", "classic"] as const) {
      const theme = THEMES[style];
      for (const selected of [null, "A"]) {
        expect(individualColors(node, theme, { A: COPY_COLORS[0] }, selected).font.color).toBe("#000000");
        expect(individualColors(node, theme, { A: COPY_COLORS[2] }, selected).font.color).toBe("#FFFFFF");
        expect(individualColors(node, theme, {}, selected, new Set(["A"])).font.color).toBe("#000000");
      }
    }
    // A label under its symbol (Modern, a self) sits on the canvas, not the fill.
    expect(nodeLabelColor("diamond", COPY_COLORS[0], THEMES.modern.text)).toBe(THEMES.modern.text);
  });

  it("the export writes the same label colors", () => {
    const graph: GraphData = { nodes: ["L", "D", "U"].map(id => (
      { id, label: id, x: 0, y: 0, generation: 0, cross_type: "cross" })), edges: [] };
    for (const style of ["modern", "classic"] as const) {
      const model = buildChartModel(graph, false);
      const { svg } = buildSvg({ model, positions: gridLayout(model), style, orientation: "UD",
        crossSymbolSize: 12, colorMap: { L: COPY_COLORS[0], D: COPY_COLORS[2], U: UNKNOWN_COPIES_COLOR },
        hatched: ["U"] });
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      const fillOf = (id: string) =>
        [...doc.querySelectorAll("text.individual")].find(t => t.textContent === id)!.getAttribute("fill");
      expect([fillOf("L"), fillOf("D"), fillOf("U")], style).toEqual(["#000000", "#FFFFFF", "#000000"]);
      expect(doc.querySelector("pattern#unknown-hatch")).not.toBeNull();
    }
  });
});
