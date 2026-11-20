import { describe, expect, it } from "vitest";
import { buildChartModel, gridLayout } from "./model";
import { buildLegend, buildSvg, type SvgExportInput } from "./svgExport";
import { pngScale, MAX_PNG_DIMENSION } from "./imageExport";
import { contrastRatio, labelColorOn } from "./style";
import { appleColorS1S2, appleGala, appleGraph, applePedigree, syntheticGraph } from "../test/fixtures";
import type { GraphData } from "../hooks/useApi";

function exportOf(graph: GraphData, extra: Partial<SvgExportInput> = {}) {
  const model = buildChartModel(graph, true);
  return buildSvg({
    model, positions: gridLayout(model), colorMap: {}, style: "classic",
    orientation: "UD", crossSymbolSize: 12, ...extra,
  });
}

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  return doc;
}

describe("SVG export of the Gala subpopulation", () => {
  const trait = applePedigree.traits.find(t => t.name === "S1_S2")!;
  const legend = buildLegend(trait, appleGala.nodes, appleColorS1S2);
  const { svg } = exportOf(appleGala, { colorMap: appleColorS1S2, legend });
  const doc = parse(svg);

  it("has one text element per individual, plus the legend entries", () => {
    const names = [...doc.querySelectorAll("text.individual")].map(t => t.textContent);
    expect(names).toEqual(appleGala.nodes.map(n => n.label));
    expect(names).toContain("Cox's-Orange-Pippin");          // apostrophe escaped and restored

    expect(legend?.kind).toBe("discrete");
    const entries = legend!.kind === "discrete" ? legend!.entries : [];
    const legendTexts = [...doc.querySelectorAll("text.legend")].map(t => t.textContent);
    expect(legendTexts).toEqual(entries.map(e => e.label));
    expect(legendTexts).toContain("Missing");                // Kidd's-Orange-Red, Gala-self-01
    expect(doc.querySelector("text.legend-title")?.textContent).toBe("S1_S2");
    expect(doc.querySelectorAll("text")).toHaveLength(names.length + legendTexts.length + 1);
  });

  it("draws female, male and uniparental links in red, blue and purple", () => {
    const strokes = (role: string) =>
      new Set([...doc.querySelectorAll(`path.link-${role}`)].map(p => p.getAttribute("stroke")));
    expect(strokes("female")).toEqual(new Set(["#E02020"]));
    expect(strokes("male")).toEqual(new Set(["#2040E0"]));
    expect(strokes("uniparental")).toEqual(new Set(["#800080"]));
  });

  it("fills nodes with their trait color, and pale yellow without one", () => {
    const fills = [...doc.querySelectorAll("g.node rect")].map(r => r.getAttribute("fill"));
    expect(fills).toContain(appleColorS1S2["Gala"]);
    const plain = parse(exportOf(appleGala).svg);
    expect(new Set([...plain.querySelectorAll("g.node rect")].map(r => r.getAttribute("fill"))))
      .toEqual(new Set(["#FFFF96"]));
  });

  it("draws each cross as an × of two lines, with no text", () => {
    const crosses = doc.querySelectorAll("g.crosses g.cross");
    expect(crosses).toHaveLength(2);                          // Kidd's-Orange-Red and Gala
    for (const c of crosses) expect(c.querySelectorAll("line")).toHaveLength(2);
  });
});

describe("accented names", () => {
  it("keep their characters in the SVG", () => {
    const doc = parse(exportOf(appleGraph).svg);
    const names = [...doc.querySelectorAll("text.individual")].map(t => t.textContent);
    expect(names).toContain("Šampion");
    expect(names).toHaveLength(appleGraph.nodes.length);
  });

  it("embed the font when asked", () => {
    const { svg } = exportOf(appleGala, { fontBase64: "AAAA" });
    expect(svg).toContain('@font-face{font-family:"Noto Sans";src:url(data:font/ttf;base64,AAAA)');
  });
});

describe("continuous legend", () => {
  it("uses the chosen low, high and missing colors", () => {
    const graph = syntheticGraph([["A", null, null], ["B", null, null]]);
    graph.nodes[0].traits = { Size: 3 };
    const meta = { name: "Size", type: "continuous", min: 1, max: 9, categories: [],
                   color_low: "#000000", color_high: "#FFFFFF" };
    const legend = buildLegend(meta, graph.nodes, {}, { low: "#112233", high: "#445566", missing: "#778899" });
    expect(legend).toEqual({ trait: "Size", kind: "continuous", min: 1, max: 9,
                             low: "#112233", high: "#445566", missing: "#778899" });
    const doc = parse(exportOf(graph, { legend }).svg);
    expect([...doc.querySelectorAll("text.legend")].map(t => t.textContent)).toEqual(["1", "9", "Missing"]);
    const fills = [...doc.querySelectorAll("g.legend rect")].map(r => r.getAttribute("fill"));
    expect(fills[0]).toBe("#112233");
    expect(fills).toContain("#445566");
    expect(fills).toContain("#778899");
  });
});

describe("PNG scale", () => {
  it("is 2x for an ordinary chart", () => {
    const { width, height } = exportOf(appleGraph);
    expect(pngScale(width, height)).toMatchObject({ scale: 2, reduced: false });
  });

  it("is reduced so a wide pedigree stays within the canvas limit", () => {
    // 600 founders in one generation, each with one selfed child.
    const rows: [string, string | null, string | null, string?][] = [];
    for (let i = 0; i < 600; i++) rows.push([`F${i}`, null, null]);
    for (let i = 0; i < 600; i++) rows.push([`S${i}`, `F${i}`, `F${i}`, "self"]);
    const { width, height } = exportOf(syntheticGraph(rows));
    expect(width * 2).toBeGreaterThan(MAX_PNG_DIMENSION);

    const size = pngScale(width, height);
    expect(size.reduced).toBe(true);
    expect(size.scale).toBeLessThan(2);
    expect(size.width).toBeLessThanOrEqual(MAX_PNG_DIMENSION);
    expect(size.height).toBeLessThanOrEqual(MAX_PNG_DIMENSION);
    expect(size.width).toBeGreaterThan(MAX_PNG_DIMENSION - 2);     // uses the room it has
  });
});

describe("export background", () => {
  const modern = (background?: "white" | "screen") =>
    parse(exportOf(appleGala, { style: "modern", background,
      legend: buildLegend(applePedigree.traits.find(t => t.name === "S1_S2"), appleGala.nodes, appleColorS1S2),
      colorMap: appleColorS1S2 }).svg);
  const labelColor = (doc: Document, name: string) =>
    [...doc.querySelectorAll("text.individual")].find(t => t.textContent === name)!.getAttribute("fill");

  it("is white by default, with page text in the print color", () => {
    const doc = modern();
    expect(doc.querySelector("rect.background")!.getAttribute("fill")).toBe("#FFFFFF");
    expect(labelColor(doc, "Gala-self-01")).toBe("#1F2937");          // label under a selfing's diamond
    // Inside its node, the name takes black or white by the node's fill (its
    // S1_S2 color here), not the page.
    expect(labelColor(doc, "Gala")).toBe(labelColorOn(appleColorS1S2.Gala));
    expect(contrastRatio(labelColor(doc, "Gala")!, appleColorS1S2.Gala)).toBeGreaterThanOrEqual(4.5);
    expect(doc.querySelector("text.legend")!.getAttribute("fill")).toBe("#1F2937");
  });

  it("can keep the background as on screen", () => {
    const doc = modern("screen");
    expect(doc.querySelector("rect.background")!.getAttribute("fill")).toBe("#0f1117");
    expect(labelColor(doc, "Gala-self-01")).toBe("#e8ecf4");
  });
});

describe("routed links in the export", () => {
  it("are one path per link; arrows only where a link ends at an individual", () => {
    const model = buildChartModel(appleGala, true);
    const doc = parse(exportOf(appleGala, { style: "modern" }).svg);
    expect(doc.querySelectorAll("g.links path")).toHaveLength(model.links.length);
    const intoIndividuals = model.links.filter(l => !model.crossIds.has(l.to)).length;
    expect(doc.querySelectorAll("g.links polygon.arrow")).toHaveLength(intoIndividuals);
    expect(parse(exportOf(appleGala).svg).querySelectorAll("polygon.arrow")).toHaveLength(0);  // Classic: none
  });
});

describe("haplotype boxes in the export", () => {
  it("are written item for item as the canvas draws them", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { DEFAULT_HAPLOTYPE_SETTINGS, palette } = await import("../lib/haplotype");
    const { haplotypeBoxes } = await import("../components/PedigreeCanvas");
    const { THEMES } = await import("./style");
    const read = (f: string) => JSON.parse(readFileSync(resolve("src/test/fixtures", f), "utf-8"));
    const graph = read("pm_small.json").graph as GraphData;
    const data = read("haplotypes.json").binko_ibd.groups["1"];
    const model = buildChartModel(graph, true);
    const view = { data, settings: DEFAULT_HAPLOTYPE_SETTINGS, columns: ["Parent 1", "Parent 2"] as [string, string],
                   colorOf: palette(data, graph.nodes.map(n => n.id), "founder").colorOf };
    for (const style of ["classic", "modern"] as const) {
      const boxes = haplotypeBoxes(model, view, THEMES[style], {}, new Set());
      const doc = parse(exportOf(graph, { style, haplotypeBoxes: boxes, positions: gridLayout(model, { level: 90, sibling: 200 }) }).svg);
      expect(doc.querySelectorAll("g.node.haplotype")).toHaveLength(model.individuals.length);
      const count = (role: string) => Object.values(boxes).reduce((n, b) => n + b.items.filter(i => i.role === role).length, 0);
      expect(doc.querySelectorAll("rect.segment")).toHaveLength(count("segment"));
      expect(doc.querySelectorAll("line.position-tick")).toHaveLength(count("position-tick"));
      expect(doc.querySelectorAll("text.individual")).toHaveLength(model.individuals.length);
      expect(doc.querySelectorAll("ellipse, polygon:not(.arrow)")).toHaveLength(0);     // no node shapes
      // A dummy founder's bars: its own two founder alleles (rows the parser supplied).
      const dummy = [...doc.querySelectorAll("g.node.haplotype")].find(g => g.textContent === "DUMMY_G1_007_F")!;
      expect(new Set([...dummy.querySelectorAll("rect.segment")].map(r => r.getAttribute("fill"))).size).toBe(2);
    }
  });
});
