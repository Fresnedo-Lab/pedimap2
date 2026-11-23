import { beforeAll, describe, expect, it } from "vitest";
import { buildChartModel, gridLayout } from "./model";
import { buildSvg } from "./svgExport";
import { loadPdfLibraries, svgToPdf } from "./imageExport";
import { appleGraph, notoSansBase64 } from "../test/fixtures";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_HAPLOTYPE_SETTINGS, founderAlleleLegend, haplotypeBox, palette, type HaplotypeData } from "../lib/haplotype";
import { THEMES } from "./style";
import { textWidth } from "./svgExport";

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number; size: number[] }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const text = content.items.map(i => ("str" in i ? i.str : "")).join("\n");
  return { text, pages: doc.numPages, size: page.view.slice(2) };
}

// jsdom has no layout or canvas. svg2pdf.js measures text in the DOM only
// for its bounding-box bookkeeping (placement uses the PDF font's metrics, see
// anchorTextWithPdfMetrics), so a stand-in is enough here.
beforeAll(() => {
  Object.assign(SVGElement.prototype, {
    getBBox(this: SVGElement) { return { x: 0, y: 0, width: (this.textContent ?? "").length * 6, height: 12 }; },
  });
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

describe("PDF export", () => {
  const model = buildChartModel(appleGraph, true);
  const { svg, width, height } = buildSvg({
    model, positions: gridLayout(model), colorMap: {}, style: "classic",
    orientation: "UD", crossSymbolSize: 12,
  });

  it("keeps names as text in the embedded font, accented names included", async () => {
    const bytes = await svgToPdf(svg, width, height, "fit", notoSansBase64(), await loadPdfLibraries());
    const raw = new TextDecoder("latin1").decode(bytes);
    expect(raw).toMatch(/\/FontFile2/);                       // TrueType font embedded
    // One embedded Noto Sans (a CID font, so any Unicode name can be shown),
    // and no built-in PDF font in use for the text.
    expect(raw.match(/\/Type0[^]*?\/BaseFont \/Noto#20Sans/g)).toHaveLength(1);
    expect(raw).toMatch(/\/Encoding \/Identity-H/);

    const { text, pages, size } = await pdfText(bytes);
    expect(pages).toBe(1);
    expect(size.map(Math.round)).toEqual([Math.round(width), Math.round(height)]);
    for (const n of appleGraph.nodes) expect(text).toContain(n.label);
    expect(text).toContain("Šampion");
  }, 30_000);

  it("keeps the hatching of unknown values as a PDF pattern", async () => {
    const hatchedSvg = buildSvg({
      model, positions: gridLayout(model), colorMap: {}, style: "classic", orientation: "UD",
      crossSymbolSize: 12, hatched: [appleGraph.nodes[0].id],
      legend: { trait: "Copies", kind: "discrete", entries: [{ label: "Unknown", color: "#9CA3AF", hatch: true }] },
    });
    const bytes = await svgToPdf(hatchedSvg.svg, hatchedSvg.width, hatchedSvg.height, "fit",
                                 notoSansBase64(), await loadPdfLibraries());
    const raw = new TextDecoder("latin1").decode(bytes);
    expect(raw).toMatch(/\/PatternType 1/);                    // a tiling pattern
  }, 30_000);

  it("fits the chart on a landscape A4 page", async () => {
    const bytes = await svgToPdf(svg, width, height, "a4", notoSansBase64(), await loadPdfLibraries());
    const { text, size } = await pdfText(bytes);
    expect(size.map(Math.round)).toEqual([842, 595]);
    expect(text).toContain("Šampion");
  }, 30_000);

  it("keeps the founder-allele legend's colors as RGB fills", async () => {
    const fixtures = (f: string) => JSON.parse(readFileSync(resolve("src/test/fixtures", f), "utf-8"));
    const graph = fixtures("example.json").graph;
    const data: HaplotypeData = fixtures("haplotypes.json").example.groups.A;
    const ibdModel = buildChartModel(graph, true);
    const { colorOf } = palette(data, graph.nodes.map((n: { id: string }) => n.id), "founder");
    const boxes = Object.fromEntries(ibdModel.individuals.map(n => [n.id, haplotypeBox({
      name: n.label, fill: THEMES.classic.defaultFill, theme: THEMES.classic, data,
      homologues: data.rows[n.id] ?? null, colorOf, settings: DEFAULT_HAPLOTYPE_SETTINGS, textWidth,
    })]));
    const legend = founderAlleleLegend(data, Object.values(boxes), DEFAULT_HAPLOTYPE_SETTINGS);
    const out = buildSvg({ model: ibdModel, positions: gridLayout(ibdModel), colorMap: {}, style: "classic",
                           orientation: "LR", crossSymbolSize: 12, haplotypeBoxes: boxes, founderLegend: legend });
    const bytes = await svgToPdf(out.svg, out.width, out.height, "fit", notoSansBase64(), await loadPdfLibraries());

    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const page = await (await pdfjs.getDocument({ data: bytes.slice() }).promise).getPage(1);
    const ops = await page.getOperatorList();
    const fills = new Set<string>();
    ops.fnArray.forEach((fn, i) => {
      if (fn !== pdfjs.OPS.setFillRGBColor) return;
      const [arg] = ops.argsArray[i] as unknown[];
      fills.add(typeof arg === "string" ? arg.toLowerCase()
        : "#" + (ops.argsArray[i] as number[]).map(v => v.toString(16).padStart(2, "0")).join(""));
    });
    const colors = legend.rows.flatMap(r => r.alleles.map(a => a.color.toLowerCase()));
    expect(colors.length).toBe(8);
    // PDF stores each channel as a number from 0 to 1, so it comes back within
    // two levels of 255.
    const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const close = (a: string, b: string) => rgb(a).every((v, i) => Math.abs(v - rgb(b)[i]) <= 2);
    for (const c of colors) expect([...fills].some(f => close(f, c)), `${c} in ${[...fills]}`).toBe(true);
    const { text } = await pdfText(bytes);
    expect(text).toContain("Founder alleles, linkage group A (below 0.10 merged)");
  }, 30_000);
});
