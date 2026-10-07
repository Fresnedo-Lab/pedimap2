import { describe, expect, it } from "vitest";
import { buildChartModel, gridLayout } from "./model";
import { buildLegend, buildSvg, type SvgExportInput } from "./svgExport";
import { pngScale, MAX_PNG_DIMENSION } from "./imageExport";
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
