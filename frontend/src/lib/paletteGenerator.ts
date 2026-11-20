// lib/paletteGenerator.ts
// =======================
// Generates the founder-allele palettes of the haplotype display
// (docs/design/haplotype-display.md, §2) that palettes.ts stores.
//
// Founders are colored in rank order among the contributing founders, so a
// sequence is built greedily: each next pair of shades (or single color) is
// the candidate farthest from every color already chosen, measured with
// CIEDE2000 under normal vision and the three simulated color-vision
// deficiencies at once. The first few, all a subpopulation usually needs,
// are then the most separated. A second founder sequence is refined for many
// founders at once: each pair in turn is replaced by the candidate farthest
// from all the others, which raises the closest pair of the whole set at the
// cost of the first few.
//
// Regenerate (about two minutes):
//   GENERATE_PALETTES=1 npx vitest run src/lib/paletteGenerator.test.ts

import { deltaE2000, oklch, simulate, VISIONS } from "./colorScience";

/** Colors the palettes keep away from: the remainder of merged narrow
 *  segments (REMAINDER_COLOR), the not-highlighted gray and the hatch's light
 *  stripes (NOT_HIGHLIGHTED, HATCH.ink), the hatch's gray (HATCH.fill), and
 *  white. A test checks that these are still the colors the display uses. */
export const RESERVED = ["#4B5563", "#E5E7EB", "#9CA3AF", "#FFFFFF"];
/** No palette color comes closer than this (CIEDE2000, any vision) to the
 *  remainder gray (RESERVED[0]), so a merged remainder never passes for a
 *  founder allele. The other reserved colors are only kept as far as the
 *  greedy choice allows. */
export const RESERVED_DISTANCE = 10;

const HUES = Array.from({ length: 36 }, (_, i) => i * 10);
const CHROMAS = [0.06, 0.10, 0.14, 0.18];
const LIGHT = [0.94, 0.90, 0.86, 0.82, 0.78, 0.74, 0.70];
/** A founder's two shades differ this much in OKLCH lightness. */
const SHADE_STEPS = [0.22, 0.30];
const SINGLE = [0.90, 0.84, 0.78, 0.72, 0.66, 0.60, 0.54, 0.48];

interface Candidate { key: string; colors: string[]; seen: string[][] }   // seen[color][vision]

const seen = (hex: string) => VISIONS.map(v => simulate(hex, v));

function distance(c: Candidate, others: string[][]): number {
  let best = Infinity;
  for (const s of c.seen) for (const o of others) for (let v = 0; v < VISIONS.length; v++) {
    best = Math.min(best, deltaE2000(s[v], o[v]));
  }
  return best;
}

function farthest(candidates: Candidate[], others: string[][], taken: Set<string>): Candidate {
  let best = candidates[0], score = -1;
  for (const c of candidates) {
    if (taken.has(c.key)) continue;
    const d = distance(c, others);
    if (d > score) { best = c; score = d; }
  }
  return best;
}

function pick(candidates: Candidate[], count: number, refinePasses: number): string[][] {
  const reserved = RESERVED.map(seen);
  const chosen: Candidate[] = [];
  for (let i = 0; i < count; i++) {
    const others = [...reserved, ...chosen.flatMap(c => c.seen)];
    chosen.push(farthest(candidates, others, new Set(chosen.map(c => c.key))));
  }
  for (let pass = 0; pass < refinePasses; pass++) {
    for (let i = 0; i < count; i++) {
      const rest = chosen.filter((_, j) => j !== i);
      const others = [...reserved, ...rest.flatMap(c => c.seen)];
      const alternative = farthest(candidates, others, new Set(rest.map(c => c.key)));
      if (distance(alternative, others) > distance(chosen[i], others)) chosen[i] = alternative;
    }
  }
  return chosen.map(c => c.colors);
}

/** Distinct candidates that keep RESERVED_DISTANCE from the remainder gray. */
function unique(candidates: Candidate[]): Candidate[] {
  const keys = new Set<string>();
  const reserved = [seen(RESERVED[0])];
  return candidates.filter(c => !keys.has(c.key) && keys.add(c.key)
                                && distance(c, reserved) >= RESERVED_DISTANCE);
}

/** `count` pairs of shades (light, dark) of one hue each. */
export function generateFounderPairs(count: number, refinePasses = 0): [string, string][] {
  const candidates = unique(HUES.flatMap(h => CHROMAS.flatMap(c => LIGHT.flatMap(l =>
    SHADE_STEPS.map(step => {
      const colors = [oklch(l, c, h), oklch(l - step, c, h)];
      return { key: colors.join(), colors, seen: colors.map(seen) };
    })))));
  return pick(candidates, count, refinePasses) as [string, string][];
}

/** `count` single colors, one per founder allele. */
export function generateAlleleColors(count: number): string[] {
  const candidates = unique(HUES.flatMap(h => CHROMAS.flatMap(c => SINGLE.map(l => {
    const hex = oklch(l, c, h);
    return { key: hex, colors: [hex], seen: [seen(hex)] };
  }))));
  return pick(candidates, count, 0).map(c => c[0]);
}
