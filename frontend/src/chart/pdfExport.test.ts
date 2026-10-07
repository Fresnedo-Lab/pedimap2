import { beforeAll, describe, expect, it } from "vitest";
import { buildChartModel, gridLayout } from "./model";
import { buildSvg } from "./svgExport";
import { loadPdfLibraries, svgToPdf } from "./imageExport";
import { appleGraph, notoSansBase64 } from "../test/fixtures";

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

  it("fits the chart on a landscape A4 page", async () => {
    const bytes = await svgToPdf(svg, width, height, "a4", notoSansBase64(), await loadPdfLibraries());
    const { text, size } = await pdfText(bytes);
    expect(size.map(Math.round)).toEqual([842, 595]);
    expect(text).toContain("Šampion");
  }, 30_000);
});
