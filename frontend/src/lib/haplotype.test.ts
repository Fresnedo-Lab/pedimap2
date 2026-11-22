import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BOX, DEFAULT_HAPLOTYPE_SETTINGS, NOT_HIGHLIGHTED, REMAINDER_COLOR, SMALL_PALETTE_FOUNDERS,
  bands, contributingAlleles, contributingFounders, founderShades, haplotypeBox, palette, segments,
  type BoxItem, type HaplotypeData,
} from "./haplotype";
import { FOUNDER_PAIRS_LARGE, FOUNDER_PAIRS_SMALL } from "./palettes";
import { THEMES, contrastRatio } from "../chart/style";

// /api/haplotypes replies for the fixtures (backend/tests/test_frontend_fixture.py).
const fixture = JSON.parse(readFileSync(resolve("src/test/fixtures/haplotypes.json"), "utf-8"));
const flexqtl = (g: string) => fixture.flexqtl.groups[g] as HaplotypeData;
const binko = (g: string) => fixture.binko_ibd.groups[g] as HaplotypeData;
const example = (g: string) => fixture.example.groups[g] as HaplotypeData;
const G3_010 = fixture.flexqtl.subpop.G3_010 as string[];

describe("bands", () => {
  it("run between midpoints of the IBD positions, the outer ones to the map's ends", () => {
    const b = bands(flexqtl("1"));
    expect(b).toHaveLength(21);
    expect([b[0].from, b[0].to, b[1].from, b[20].to]).toEqual([0, 2.5, 2.5, 100]);
  });

  it("place a position between markers (binko_ibd.ped, 5 cM)", () => {
    const data = binko("1");
    expect(data.positions.map(p => p.cM)).toEqual([5, 20]);
    expect(data.markers.map(m => [m.name, m.position])).toEqual(
      [["M1_001", null], ["M1_002", null], ["M1_003", "20.0000"], ["M1_004", null]]);
    expect(bands(data).map(b => [b.from, b.to])).toEqual([[data.start_cM, 12.5], [12.5, data.end_cM]]);
  });
});

describe("segments", () => {
  it("follow founder-allele order, widths scaled to the homologue's sum", () => {
    const s = segments([[24, 0.05], [23, 0.95]], 100);           // wide enough for both
    expect(s.map(x => [x.allele, x.probability])).toEqual([[23, 0.95], [24, 0.05]]);
    expect(s[0].share).toBeCloseTo(0.95, 12);
    expect(s[1].share).toBeCloseTo(0.05, 12);
    const rounded = segments([[3, 0.34], [1, 0.34], [2, 0.34]], 100);   // FlexQTL-style sum 1.02
    expect(rounded.map(x => x.probability)).toEqual([0.34, 0.34, 0.34]);  // as read
    expect(rounded.reduce((t, x) => t + x.share, 0)).toBeCloseTo(1, 12);  // drawn to fill the bar
  });

  it("merge segments narrower than a pixel into a remainder at the end", () => {
    const s = segments([[1, 0.9], [5, 0.06], [7, 0.02], [9, 0.02]], 10);
    expect(s.map(x => x.allele)).toEqual([1, null]);
    expect(s[1].merged).toEqual([[5, 0.06], [7, 0.02], [9, 0.02]]);
    expect(s[1].probability).toBeCloseTo(0.1, 12);
  });
});

describe("contributing founders", () => {
  it("are every founder in the whole FlexQTL population", () => {
    for (const g of ["1", "2"]) {
      const data = flexqtl(g);
      expect(contributingFounders(data, Object.keys(data.rows))).toHaveLength(29);
      expect(contributingAlleles(data, Object.keys(data.rows))).toHaveLength(58);
    }
  });

  it("are only those of a subpopulation (G3_010 and its relatives)", () => {
    const data = flexqtl("1");
    const founders = contributingFounders(data, G3_010);
    expect(founders.length).toBeLessThan(29);
    // Every allele in the subpopulation's rows belongs to one of them.
    for (const id of G3_010) for (const h of data.rows[id]) for (const band of h) {
      for (const [a] of band) expect(founders).toContain(Math.floor((a - 1) / 2));
    }
  });

  it("include a Binko dummy founder through the row the parser supplied", () => {
    const data = binko("1");
    const k = data.founders!.indexOf("DUMMY_G1_007_F");
    expect(data.rows.DUMMY_G1_007_F[0].map(b => b.map(([a]) => a))).toEqual([[2 * k + 1], [2 * k + 1]]);
    expect(contributingFounders(data, ["DUMMY_G1_007_F"])).toEqual([k]);
  });
});

describe("palettes", () => {
  const legendAlleles = (data: HaplotypeData, ids: string[], scheme: "founder" | "allele") =>
    palette(data, ids, scheme).legend.flatMap(r => r.swatches.map(s => s.allele));

  it("list exactly the contributing founder alleles in the legend", () => {
    for (const ids of [Object.keys(flexqtl("1").rows), G3_010]) {
      const data = flexqtl("1");
      expect(legendAlleles(data, ids, "founder")).toEqual(
        contributingFounders(data, ids).flatMap(k => [2 * k + 1, 2 * k + 2]));
      expect(legendAlleles(data, ids, "allele")).toEqual(contributingAlleles(data, ids));
    }
  });

  it("by founder: one founder's two shades, from the sequence its count calls for", () => {
    const data = flexqtl("1");
    const sub = palette(data, G3_010, "founder");
    const n = contributingFounders(data, G3_010).length;
    expect(n).toBeLessThanOrEqual(SMALL_PALETTE_FOUNDERS);
    expect(sub.legend[0].swatches.map(s => s.color)).toEqual(FOUNDER_PAIRS_SMALL[0]);
    const whole = palette(data, Object.keys(data.rows), "founder");
    expect(whole.legend[0].swatches.map(s => s.color)).toEqual(FOUNDER_PAIRS_LARGE[0]);
    expect(whole.legend[0].label).toBe(data.founders![0]);
    expect(founderShades(40, 41)).toHaveLength(2);                    // beyond the stored ones
  });

  it("highlight: chosen alleles in strong colors, the rest gray, and so in the legend", () => {
    const data = flexqtl("1");
    const p = palette(data, G3_010, "highlight", [contributingAlleles(data, G3_010)[0], 999]);
    expect(p.legend.map(r => r.label).at(-1)).toBe("Other founder alleles");
    expect(p.legend).toHaveLength(2);                                  // 999 is not present
    expect(p.colorOf(contributingAlleles(data, G3_010)[1])).toBe(NOT_HIGHLIGHTED);
  });

  it("name founder alleles by number when the file does not name founders", () => {
    const data = { ...flexqtl("1"), founders: null };
    expect(palette(data, G3_010, "founder").legend[0].label).toMatch(/^Founder alleles \d+–\d+$/);
  });
});

describe("haplotypeBox", () => {
  const width = (t: string, size: number) => t.length * size * 0.6;
  const box = (data: HaplotypeData, id: string, fill = "#FFFF96") => haplotypeBox({
    name: id, fill, theme: THEMES.classic, data, homologues: data.rows[id] ?? null,
    colorOf: palette(data, Object.keys(data.rows), "founder").colorOf,
    settings: DEFAULT_HAPLOTYPE_SETTINGS, textWidth: width,
  });
  const of = <R extends BoxItem["role"]>(b: { items: BoxItem[] }, role: R) =>
    b.items.filter((i): i is Extract<BoxItem, { role: R }> => i.role === role);

  it("draws two bars along the map with one row of segments per band", () => {
    const data = flexqtl("1"), b = box(data, "G1_001");
    const { barWidth, barHeight } = DEFAULT_HAPLOTYPE_SETTINGS;
    expect(of(b, "bar").map(r => [r.w, r.h])).toEqual([[barWidth, barHeight], [barWidth, barHeight]]);
    for (const h of [0, 1]) {
      const segs = of(b, "segment").filter(s => s.homologue === h);
      expect(new Set(segs.map(s => s.band)).size).toBe(21);
      for (let band = 0; band < 21; band++) {         // each band filled across the bar
        const row = segs.filter(s => s.band === band);
        expect(row.reduce((t, s) => t + s.w, 0)).toBeCloseTo(barWidth, 9);
      }
      expect(segs.reduce((t, s) => t + s.h * s.w, 0)).toBeCloseTo(barWidth * barHeight, 6);
    }
    // G1_001 at 0 cM: first homologue on founder allele 23 at 0.95 (spec 5.5); the
    // 0.05 of allele 24 is half a pixel wide, so it is merged into the remainder.
    const first = of(b, "segment").filter(s => s.homologue === 0 && s.band === 0);
    expect(first.map(s => [s.segment.allele, s.segment.probability])).toEqual([[23, 0.95], [null, 0.05]]);
    expect(first[1].fill).toBe(REMAINDER_COLOR);
    expect(of(b, "segment").find(s => s.homologue === 1 && s.band === 0)!.segment.allele).toBe(38);
  });

  it("ticks every IBD position, and every other marker unless turned off", () => {
    const data = binko("1"), b = box(data, "G1_001");
    expect(of(b, "position-tick")).toHaveLength(2 * data.positions.length);
    // M1_003 is at the IBD position 20 cM, so it has that tick only.
    expect(of(b, "marker-tick")).toHaveLength(2 * 3);
    expect(of(box(flexqtl("1"), "G1_001"), "marker-tick")).toHaveLength(0);   // all at positions
    const off = haplotypeBox({ name: "G1_001", fill: "#FFFF96", theme: THEMES.classic, data,
      homologues: data.rows.G1_001, colorOf: () => "#000000", textWidth: width,
      settings: { ...DEFAULT_HAPLOTYPE_SETTINGS, markerTicks: false } });
    expect(of(off, "marker-tick")).toHaveLength(0);
  });

  it("grows with the name and keeps every item inside", () => {
    const data = example("A"), short = box(data, "Cox"), long = box(data, "A-very-long-cultivar-name");
    expect(short.width).toBe(BOX.minWidth);
    expect(long.width).toBeGreaterThan(short.width);
    for (const b of [short, long]) for (const i of b.items) {
      if (i.kind === "rect") expect(i.x >= 0 && i.y >= 0 && i.x + i.w <= b.width + 1e-9 && i.y + i.h <= b.height + 1e-9).toBe(true);
      if (i.kind === "line") expect(Math.min(i.x1, i.x2) >= 0 && Math.max(i.x1, i.x2) <= b.width).toBe(true);
    }
  });

  it("writes the name in black or white by the box fill (WCAG AA)", () => {
    for (const fill of ["#FFFF96", "#1D4ED8", "#252e42"]) {
      const name = of(box(example("A"), "Cox", fill), "name")[0];
      expect(contrastRatio(name.color, fill)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
