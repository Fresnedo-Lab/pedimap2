// lib/colorScience.ts
// ===================
// Color conversions for generating and checking palettes: OKLCH to sRGB (to
// generate even-looking colors), CIE Lab and CIEDE2000 (to measure how far
// apart two colors look), and color-blindness simulation (Machado, Oliveira &
// Fernandes 2009, severity 1) to measure them as color-blind viewers see them.

type Rgb = [number, number, number];           // 0..1, gamma-encoded sRGB

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToRgb(hex: string): Rgb {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
}

export function rgbToHex(rgb: Rgb): string {
  return "#" + rgb.map(c => Math.round(Math.min(1, Math.max(0, c)) * 255)
    .toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Linear sRGB of an OKLCH color (lightness 0..1, chroma, hue in degrees). */
function oklchToLinear(l: number, c: number, h: number): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180), b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
  ];
}

/** An OKLCH color as #RRGGBB, its chroma reduced until it fits in sRGB. */
export function oklch(l: number, c: number, h: number): string {
  for (let chroma = c; chroma >= 0; chroma -= 0.005) {
    const lin = oklchToLinear(l, chroma, h);
    if (lin.every(v => v >= -1e-4 && v <= 1 + 1e-4)) return rgbToHex(lin.map(toGamma) as Rgb);
  }
  return rgbToHex(oklchToLinear(l, 0, h).map(toGamma) as Rgb);
}

/** CIE Lab (D65) of a #RRGGBB color. */
export function hexToLab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIEDE2000 color difference of two #RRGGBB colors. */
export function deltaE2000(hex1: string, hex2: string): number {
  const [L1, a1, b1] = hexToLab(hex1), [L2, a2, b2] = hexToLab(hex2);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hue = (a: number, b: number) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const h1p = hue(a1p, b1), h2p = hue(a2p, b2);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) dhp = Math.abs(h2p - h1p) <= 180 ? h2p - h1p : h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lpm = (L1 + L2) / 2, Cpm = (C1p + C2p) / 2;
  let hpm = h1p + h2p;
  if (C1p * C2p !== 0) hpm = Math.abs(h1p - h2p) <= 180 ? (h1p + h2p) / 2 : h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hpm - 30) * rad) + 0.24 * Math.cos(2 * hpm * rad)
          + 0.32 * Math.cos((3 * hpm + 6) * rad) - 0.20 * Math.cos((4 * hpm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2);
  const Sc = 1 + 0.045 * Cpm, Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

export type Vision = "normal" | "protanopia" | "deuteranopia" | "tritanopia";

// Machado, Oliveira & Fernandes (2009), severity 1.0, on linear RGB.
const CVD: Record<Exclude<Vision, "normal">, number[][]> = {
  protanopia:   [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia:   [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};

/** How a color looks with a color-vision deficiency. */
export function simulate(hex: string, vision: Vision): string {
  if (vision === "normal") return hex.toUpperCase();
  const lin = hexToRgb(hex).map(toLinear);
  const out = CVD[vision].map(row => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]);
  return rgbToHex(out.map(v => toGamma(Math.min(1, Math.max(0, v)))) as Rgb);
}

export const VISIONS: Vision[] = ["normal", "protanopia", "deuteranopia", "tritanopia"];

/** The closest pair of `colors` (smallest CIEDE2000) as seen with `vision`. */
export function closestPair(colors: string[], vision: Vision = "normal"):
    { deltaE: number; a: number; b: number } {
  const seen = colors.map(c => simulate(c, vision));
  let best = { deltaE: Infinity, a: -1, b: -1 };
  for (let i = 0; i < seen.length; i++) {
    for (let j = i + 1; j < seen.length; j++) {
      const d = deltaE2000(seen[i], seen[j]);
      if (d < best.deltaE) best = { deltaE: d, a: i, b: j };
    }
  }
  return best;
}
