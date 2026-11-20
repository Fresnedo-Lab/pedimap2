// lib/genotypeCodes.ts
// ====================
// Genotype indicator codes (the number after each allele of an ALLELES row)
// and the colorings by a marker.
//
// The meanings are FlexQTL's consistency classes as its and Binko's files use
// them (docs/reference/flexqtl-binko-pedimap, section 4.2). They are shown only
// for those files (the caption has FACTOR0; MarkerSummary.flexqtl_codes): in
// native Pedimap files the codes are only colors (dat-format.md §6.1).

import type { MarkerValues } from "../hooks/useApi";
import type { Legend } from "../chart/svgExport";

export interface CodeInfo { short: string; meaning: string }

export const CODE_INFO: Record<number, CodeInfo> = {
  0:  { short: "OC",    meaning: "Observed, and consistent with the pedigree." },
  1:  { short: "MA",    meaning: "Missing in the data and filled in from the relatives' genotypes." },
  2:  { short: "OEA",   meaning: "Observed, judged an error, removed and filled in again." },
  3:  { short: "pnuA",  meaning: "Involves a putative null allele; the genotype was completed." },
  4:  { short: "pnuM",  meaning: "Involves a putative null allele; the genotype was left missing." },
  5:  { short: "IM",    meaning: "Incomplete or missing in the data, and not filled in." },
  6:  { short: "OpE",   meaning: "Observed and flagged as a possible error, but kept." },
  7:  { short: "OE",    meaning: "Observed, judged an error and removed; the raw alleles are shown." },
  8:  { short: "pnuE",  meaning: "Involves a putative null allele and is in error." },
  9:  { short: "ME",    meaning: "Labeled \"missing and error\" by FlexQTL." },
  11: { short: "OPhE",  meaning: "Observed and consistent (class 0, 2 or 6), but the run gave no most probable phase." },
  12: { short: "MAPhE", meaning: "Filled in (class 1), but the run gave no most probable phase." },
};

export const NO_STATEMENT = "No statement: not one of FlexQTL's codes.";

/** The hover text of a code: FlexQTL's meaning in a FlexQTL or Binko file,
 *  otherwise only that it is a color code. */
export function codeTitle(code: number, flexqtl: boolean): string {
  if (!flexqtl) return `Colour code ${code}`;
  const info = CODE_INFO[code];
  return info
    ? `Code ${code} (${info.short}): ${info.meaning} (Meaning as FlexQTL and Binko use the code.)`
    : `Code ${code}: ${NO_STATEMENT}`;
}

// Codes 0-9 each have their own color; any other code is gray (dat-format.md §6.1).
const CODE_COLORS = [
  "#22C55E", "#3B82F6", "#F59E0B", "#A855F7", "#EC4899",
  "#0EA5E9", "#EAB308", "#EF4444", "#F97316", "#84CC16",
];
export const OTHER_CODE_COLOR = "#9CA3AF";
/** Fill of an individual without a genotype at the marker. */
export const NO_GENOTYPE_COLOR = "#6B7280";

export function codeColor(code: number): string {
  return Number.isInteger(code) && code >= 0 && code <= 9 ? CODE_COLORS[code] : OTHER_CODE_COLOR;
}

export type MarkerColoringMode = "code" | "allele";
export interface MarkerColoringChoice { mode: MarkerColoringMode; marker: string; allele?: string }
export interface MarkerColoring { colorMap: Record<string, string>; legend: Legend }

const COPY_COLORS = ["#DBEAFE", "#60A5FA", "#1D4ED8"];   // 0, 1, 2 copies
const UNKNOWN_COPIES_COLOR = "#CBD5E1";
const plural = (n: number) => (n === 1 ? "copy" : "copies");

/**
 * Colors by a marker for the individuals `ids`: by the genotype's code (the
 * first of the row's codes; FlexQTL and Binko write the same code twice, and
 * the legend gives FlexQTL's short names only when `flexqtl`), or
 * by how many copies of `allele` the genotype has. A genotype with an unknown
 * allele has an unknown number of copies.
 */
export function markerColoring(values: MarkerValues, choice: MarkerColoringChoice,
                               ids: string[], flexqtl: boolean): MarkerColoring {
  const colorMap: Record<string, string> = {};
  const used = new Map<string, { label: string; color: string; order: number }>();
  const use = (key: string, label: string, color: string, order: number) => {
    if (!used.has(key)) used.set(key, { label, color, order });
    return color;
  };
  for (const id of ids) {
    const v = values.values[id];
    if (!v) {
      colorMap[id] = use("none", "No genotype data", NO_GENOTYPE_COLOR, 1e9 + 1);
    } else if (choice.mode === "code") {
      const code = v.codes[0];
      const info = CODE_INFO[code];
      const label = !flexqtl ? `Code ${code}`
        : info ? `${code} · ${info.short}` : `${code} · no statement`;
      colorMap[id] = use(`c${code}`, label, codeColor(code), code);
    } else if (v.alleles.some(a => a === null)) {
      colorMap[id] = use("unknown", "Unknown", UNKNOWN_COPIES_COLOR, 1e9);
    } else {
      const n = v.alleles.filter(a => a === choice.allele).length;
      colorMap[id] = use(`n${n}`, `${n} ${plural(n)}`, COPY_COLORS[Math.min(n, 2)], n);
    }
  }
  const title = choice.mode === "code"
    ? `Genotype code at ${choice.marker}`
    : `Copies of allele ${choice.allele} at ${choice.marker}`;
  const entries = [...used.values()].sort((a, b) => a.order - b.order)
    .map(({ label, color }) => ({ label, color }));
  return { colorMap, legend: { trait: title, kind: "discrete", entries } };
}
