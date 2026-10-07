// chart/imageExport.ts
// ====================
// Turn the chart SVG (svgExport.ts) into PNG or PDF, and save files.
//
// jsPDF and svg2pdf.js are loaded with dynamic import() when the export
// dialog opens (loadPdfLibraries), so they are not in the startup bundle.

import notoSansUrl from "../assets/fonts/NotoSans-Regular.ttf?url";
import { CHART_FONT } from "./style";

export type ImageFormat = "png" | "svg" | "pdf";
export type PdfPage = "fit" | "letter" | "a4";

// ── PNG ──────────────────────────────────────────────────────────────────────

/** Browsers refuse (or silently blank) canvases larger than this per side. */
export const MAX_PNG_DIMENSION = 16_000;
export const PNG_SCALE = 2;

/**
 * Scale for rasterizing a `width` × `height` chart: 2× unless that would make
 * either side exceed MAX_PNG_DIMENSION, in which case the largest scale that
 * fits (and `reduced` is true, so the UI can say so).
 */
export function pngScale(width: number, height: number, preferred = PNG_SCALE) {
  const scale = Math.min(preferred, MAX_PNG_DIMENSION / width, MAX_PNG_DIMENSION / height);
  return {
    scale,
    reduced: scale < preferred,
    width:   Math.min(MAX_PNG_DIMENSION, Math.round(width * scale)),
    height:  Math.min(MAX_PNG_DIMENSION, Math.round(height * scale)),
  };
}

/** Rasterize an SVG (with its font embedded) to PNG bytes at `scale`. */
export async function svgToPng(svg: string, width: number, height: number): Promise<{
  bytes: Uint8Array; scale: number; reduced: boolean;
}> {
  const size = pngScale(width, height);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create a drawing canvas for the PNG.");
    ctx.drawImage(img, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The chart is too large to render as PNG.");
    return { bytes: new Uint8Array(await blob.arrayBuffer()), scale: size.scale, reduced: size.reduced };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── PDF ──────────────────────────────────────────────────────────────────────

export type PdfLibraries = {
  jsPDF:  typeof import("jspdf").jsPDF;
  svg2pdf: typeof import("svg2pdf.js").svg2pdf;
};

let pdfLibraries: Promise<PdfLibraries> | null = null;

/** Load jsPDF and svg2pdf.js on first use (export dialog opened). */
export function loadPdfLibraries(): Promise<PdfLibraries> {
  pdfLibraries ??= Promise.all([import("jspdf"), import("svg2pdf.js")])
    .then(([pdf, s2p]) => ({ jsPDF: pdf.jsPDF, svg2pdf: s2p.svg2pdf }))
    .catch(e => { pdfLibraries = null; throw e; });
  return pdfLibraries;
}

// Landscape page sizes in points.
const PAGES: Record<Exclude<PdfPage, "fit">, [number, number]> = {
  letter: [792, 612],
  a4:     [841.89, 595.28],
};
const PAGE_MARGIN = 36;

/**
 * Vector PDF of the chart SVG. Text stays text, in the embedded Noto Sans.
 * "fit" makes the page the size of the chart; "letter"/"a4" use a landscape
 * page and scale the chart down (never up) to fit inside the margins.
 */
export async function svgToPdf(
  svg: string, width: number, height: number, page: PdfPage,
  fontBase64: string, libs: PdfLibraries,
): Promise<Uint8Array> {
  const [pw, ph] = page === "fit" ? [width, height] : PAGES[page];
  const doc = new libs.jsPDF({
    unit: "pt", format: [pw, ph], orientation: pw >= ph ? "landscape" : "portrait",
    compress: true,
  });
  // The chart SVG uses only this regular weight: any other style would make
  // svg2pdf fall back to a built-in PDF font, which cannot show every name.
  doc.addFileToVFS("NotoSans-Regular.ttf", fontBase64);
  doc.addFont("NotoSans-Regular.ttf", CHART_FONT, "normal");
  doc.setFont(CHART_FONT, "normal");

  let x = 0, y = 0, w = width, h = height;
  if (page !== "fit") {
    const s = Math.min(1, (pw - 2 * PAGE_MARGIN) / width, (ph - 2 * PAGE_MARGIN) / height);
    w = width * s; h = height * s;
    x = (pw - w) / 2; y = (ph - h) / 2;
  }
  const element = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  anchorTextWithPdfMetrics(element, doc);
  await libs.svg2pdf(element, doc, { x, y, width: w, height: h });
  return new Uint8Array(doc.output("arraybuffer"));
}

// svg2pdf.js places centered and end-anchored text by measuring it in the DOM,
// which uses whatever font the page has loaded. Measure with the PDF's own
// Noto Sans metrics instead and rewrite such text as start-anchored, so the
// placement is exact and does not depend on the page.
function anchorTextWithPdfMetrics(svg: Element, doc: InstanceType<PdfLibraries["jsPDF"]>) {
  for (const text of Array.from(svg.querySelectorAll("text"))) {
    const anchor = text.getAttribute("text-anchor");
    if (anchor !== "middle" && anchor !== "end") continue;
    const sized = text.closest("[font-size]");
    doc.setFontSize(parseFloat(sized?.getAttribute("font-size") ?? "12"));
    const width = doc.getTextWidth(text.textContent ?? "");
    const x = parseFloat(text.getAttribute("x") ?? "0");
    text.setAttribute("x", String(x - (anchor === "middle" ? width / 2 : width)));
    text.setAttribute("text-anchor", "start");
  }
}

// ── Font ─────────────────────────────────────────────────────────────────────

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

let chartFont: Promise<string> | null = null;

/** The bundled Noto Sans as base64, for embedding in SVG/PNG/PDF exports. */
export function loadChartFont(): Promise<string> {
  chartFont ??= fetch(notoSansUrl)
    .then(r => { if (!r.ok) throw new Error(`Could not load the chart font (${r.status}).`); return r.arrayBuffer(); })
    .then(buf => bytesToBase64(new Uint8Array(buf)))
    .catch(e => { chartFont = null; throw e; });
  return chartFont;
}
