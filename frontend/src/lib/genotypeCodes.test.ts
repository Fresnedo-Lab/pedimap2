import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MarkerValues } from "../hooks/useApi";
import { CODE_INFO, NO_GENOTYPE_COLOR, OTHER_CODE_COLOR, codeColor, codeTitle, markerColoring } from "./genotypeCodes";

const panels = JSON.parse(readFileSync(resolve("src/test/fixtures/panels.json"), "utf-8"));
const legacy = panels.binko_legacy;
const values = legacy.marker_values as MarkerValues;
const ids = ["F001", "F003", "G1_001", "DUMMY_G1_007_F", "G1_007"];

describe("genotype codes", () => {
  it("have FlexQTL's meanings for 0-9, 11 and 12, and no statement otherwise", () => {
    expect(Object.keys(CODE_INFO).map(Number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12]);
    expect(codeTitle(1, true)).toBe("Code 1 (MA): Missing in the data and filled in from the relatives' " +
      "genotypes. (Meaning as FlexQTL and Binko use the code.)");
    expect(codeTitle(11, true)).toContain("(OPhE)");
    expect(codeTitle(10, true)).toBe("Code 10: No statement: not one of FlexQTL's codes.");
    expect(codeTitle(42, true)).toContain("No statement");
  });

  it("are only colour codes in files without FACTOR0 (native Pedimap files)", () => {
    expect(codeTitle(1, false)).toBe("Colour code 1");
    expect(codeTitle(11, false)).toBe("Colour code 11");
  });

  it("color 0-9 distinctly and every other code gray", () => {
    const colors = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(codeColor);
    expect(new Set(colors).size).toBe(10);
    expect(colors).not.toContain(OTHER_CODE_COLOR);
    expect([10, 11, 12, 42].map(codeColor)).toEqual(Array(4).fill(OTHER_CODE_COLOR));
  });
});

describe("coloring by a marker (binko_legacy.ped, M1_001)", () => {
  it("by genotype code, with a legend of the codes shown", () => {
    const { colorMap, legend } = markerColoring(values, { mode: "code", marker: "M1_001" }, ids, true);
    expect(colorMap.G1_001).toBe(codeColor(1));                 // "G 1 A 1"
    expect(colorMap.F003).toBe(codeColor(5));                   // "- 5 - 5"
    expect(colorMap.DUMMY_G1_007_F).toBe(NO_GENOTYPE_COLOR);    // no row
    expect(legend).toEqual({ trait: "Genotype code at M1_001", kind: "discrete", entries: [
      { label: "0 · OC", color: codeColor(0) }, { label: "1 · MA", color: codeColor(1) },
      { label: "5 · IM", color: codeColor(5) }, { label: "No genotype data", color: NO_GENOTYPE_COLOR },
    ] });
  });

  it("by copies of an allele; an unknown allele makes the count unknown", () => {
    const { colorMap, legend } = markerColoring(values, { mode: "allele", marker: "M1_001", allele: "A" }, ids, true);
    expect(legend.trait).toBe("Copies of allele A at M1_001");
    const label = (id: string) => legend.kind === "discrete"
      ? legend.entries.find(e => e.color === colorMap[id])?.label : undefined;
    expect(values.values.G1_001.alleles).toEqual(["G", "A"]);
    expect(label("G1_001")).toBe("1 copy");
    expect(label("F003")).toBe("Unknown");
    expect(legend.kind === "discrete" && legend.entries.map(e => e.label).at(-1)).toBe("No genotype data");
  });
});

describe("coloring by genotype code in Example.dat (no FACTOR0)", () => {
  it("lists the codes without FlexQTL's meanings", () => {
    const example = panels.example;
    expect(example.pedigree.marker_summary.flexqtl_codes).toBe(false);
    expect(legacy.pedigree.marker_summary.flexqtl_codes).toBe(true);
    const { legend } = markerColoring(example.marker_values as MarkerValues,
      { mode: "code", marker: "SSR1" }, ["GoldenD", "Elstar", "Elise"],
      example.pedigree.marker_summary.flexqtl_codes);
    expect(legend.kind === "discrete" && legend.entries.map(e => e.label)).toEqual(["Code 0", "Code 2"]);
  });
});
