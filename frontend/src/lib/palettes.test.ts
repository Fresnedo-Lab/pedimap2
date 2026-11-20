// The separation the founder-allele palettes guarantee (design §2.3, §2.5):
// CIEDE2000 between colors, as seen with normal vision and with protanopia,
// deuteranopia and tritanopia simulated. These are the measured values of the
// stored palettes, kept as lower bounds so they cannot get worse.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALLELE_COLORS, FOUNDER_PAIRS_LARGE, FOUNDER_PAIRS_SMALL } from "./palettes";
import { RESERVED, RESERVED_DISTANCE } from "./paletteGenerator";
import {
  HIGHLIGHT_COLORS, NOT_HIGHLIGHTED, REMAINDER_COLOR, SMALL_PALETTE_FOUNDERS,
  contributingFounders, founderShades, palette, type HaplotypeData,
} from "./haplotype";
import { HATCH } from "../chart/svgExport";
import { VISIONS, closestPair, deltaE2000, simulate } from "./colorScience";

/** The smallest CIEDE2000 between any two of `colors`, over all four visions. */
const worst = (colors: string[]) => Math.min(...VISIONS.map(v => closestPair(colors, v).deltaE));
const shadesOf = (n: number) => Array.from({ length: n }, (_, r) => founderShades(r, n)).flat();

describe("founder palette", () => {
  it.each([
    [4, 11.9], [8, 7.3], [12, 6.4], [22, 4.2], [30, 4],
  ])("keeps %i contributing founders at least ΔE %f apart", (n, bound) => {
    expect(worst(shadesOf(n))).toBeGreaterThanOrEqual(bound);
  });

  it("keeps a founder's two shades at least ΔE 15 apart", () => {
    for (const [light, dark] of [...FOUNDER_PAIRS_SMALL, ...FOUNDER_PAIRS_LARGE]) {
      for (const v of VISIONS) expect(deltaE2000(simulate(light, v), simulate(dark, v))).toBeGreaterThanOrEqual(15);
    }
  });

  it("switches to the refined sequence where it separates better", () => {
    const at = (pairs: [string, string][], n: number) => worst(pairs.slice(0, n).flat());
    expect(at(FOUNDER_PAIRS_SMALL, SMALL_PALETTE_FOUNDERS))
      .toBeGreaterThanOrEqual(at(FOUNDER_PAIRS_LARGE, SMALL_PALETTE_FOUNDERS));
    expect(at(FOUNDER_PAIRS_LARGE, 29)).toBeGreaterThan(at(FOUNDER_PAIRS_SMALL, 29));
  });

});

describe("the remainder of merged narrow segments", () => {
  const generated = [...FOUNDER_PAIRS_SMALL.flat(), ...FOUNDER_PAIRS_LARGE.flat(), ...ALLELE_COLORS];
  const gap = (a: string, b: string) => Math.min(...VISIONS.map(v => deltaE2000(simulate(a, v), simulate(b, v))));

  it("is the gray the generator reserved, as are the other neutral fills", () => {
    expect(RESERVED).toEqual([REMAINDER_COLOR, NOT_HIGHLIGHTED, HATCH.fill, "#FFFFFF"]);
    expect(HATCH.ink).toBe(NOT_HIGHLIGHTED);
  });

  it("stands apart from every palette color, under all four visions", () => {
    for (const c of generated) expect(gap(REMAINDER_COLOR, c), c).toBeGreaterThanOrEqual(RESERVED_DISTANCE);
    for (const c of HIGHLIGHT_COLORS) expect(gap(REMAINDER_COLOR, c), c).toBeGreaterThanOrEqual(15);
  });

  it("stands apart from the hatched fill of an unknown value and the highlight gray", () => {
    expect(gap(REMAINDER_COLOR, HATCH.fill)).toBeGreaterThanOrEqual(25);    // the hatch's gray
    expect(gap(REMAINDER_COLOR, HATCH.ink)).toBeGreaterThanOrEqual(25);     // its stripes
    expect(gap(REMAINDER_COLOR, NOT_HIGHLIGHTED)).toBeGreaterThanOrEqual(25);
  });
});

describe("founder-allele palette", () => {
  it.each([[8, 11.8], [16, 8.7], [30, 6.3], [58, 4.5]])("keeps %i alleles at least ΔE %f apart", (n, bound) => {
    expect(worst(ALLELE_COLORS.slice(0, n))).toBeGreaterThanOrEqual(bound);
  });
});

describe("the FlexQTL fixture (design §2.5)", () => {
  const fixture = JSON.parse(readFileSync(resolve("src/test/fixtures/haplotypes.json"), "utf-8")).flexqtl;
  const colorsFor = (data: HaplotypeData, ids: string[]) =>
    palette(data, ids, "founder").legend.flatMap(r => r.swatches.map(s => s.color));

  it("whole population: 29 founders, 58 founder alleles, closest pair ≥ 4.0", () => {
    const data = fixture.groups["1"] as HaplotypeData, ids = Object.keys(data.rows);
    expect(contributingFounders(data, ids)).toHaveLength(29);
    expect(worst(colorsFor(data, ids))).toBeGreaterThanOrEqual(4.0);
  });

  it("subpopulation of G3_010: only its contributing founders, closest pair ≥ 11.9", () => {
    for (const g of ["1", "2"]) {
      const data = fixture.groups[g] as HaplotypeData, ids = fixture.subpop.G3_010 as string[];
      expect(contributingFounders(data, ids)).toHaveLength(4);
      expect(worst(colorsFor(data, ids))).toBeGreaterThanOrEqual(11.9);
    }
  });
});
