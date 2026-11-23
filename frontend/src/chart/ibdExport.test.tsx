// Image export with IBD bars (design §7): the bars as on screen, and a legend
// of exactly the founder alleles drawn, below a top-to-bottom chart and at the
// right of a left-to-right one, never over it. Charts are laid out by the real
// PedigreeCanvas (vis-network on a stand-in canvas), as the app exports them.

import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GraphData, PedigreeData } from "../hooks/useApi";
import { buildChartModel } from "./model";
import { HATCH, buildLegend, buildSvg, type SvgExportInput } from "./svgExport";
import { drawHaplotypeBox } from "./haplotypeCanvas";
import { THEMES, contrastRatio, type DisplayStyle } from "./style";
import { installFakeCanvas } from "../test/fakeCanvas";
import {
  DEFAULT_HAPLOTYPE_SETTINGS, REMAINDER_COLOR, founderAlleleLegend, founderOf, palette,
  type HaplotypeData, type HaplotypeSettings,
} from "../lib/haplotype";

interface RecordedNetwork { body: { emitter: { emit(event: string): void } } }
const networks: RecordedNetwork[] = [];
vi.mock("vis-network/standalone", async (importOriginal) => {
  const vis = await importOriginal<typeof import("vis-network/standalone")>();
  class Recorded extends vis.Network {
    constructor(...args: ConstructorParameters<typeof vis.Network>) { super(...args); networks.push(this as never); }
  }
  return { ...vis, Network: Recorded };
});
import PedigreeCanvas, { haplotypeBoxes, type HaplotypeView, type PedigreeCanvasHandle } from "../components/PedigreeCanvas";

installFakeCanvas();

const read = (file: string) => JSON.parse(readFileSync(resolve("src/test/fixtures", file), "utf-8"));
const haplotypes = read("haplotypes.json");
const example = read("example.json");

const CASES: { name: string; graph: GraphData; data: HaplotypeData }[] = [
  { name: "example-A", graph: example.graph, data: haplotypes.example.groups.A },
  { name: "flexqtl-1", graph: read("sim_small.json").graph, data: haplotypes.flexqtl.groups["1"] },
];

const viewOf = (data: HaplotypeData, graph: GraphData, settings: HaplotypeSettings = DEFAULT_HAPLOTYPE_SETTINGS):
  HaplotypeView => ({
  data, colorOf: palette(data, graph.nodes.map(n => n.id), "founder").colorOf,
  settings, columns: ["Parent 1", "Parent 2"],
});

/** The export input the app builds (App.tsx, buildImageInput), from the
 *  chart's real layout. */
async function exportInput(graph: GraphData, data: HaplotypeData, style: DisplayStyle,
                           orientation: "UD" | "LR", extra: Partial<SvgExportInput> = {}): Promise<SvgExportInput> {
  const model = buildChartModel(graph, true);
  const view = viewOf(data, graph);
  const ref = createRef<PedigreeCanvasHandle>();
  render(<PedigreeCanvas ref={ref} model={model} colorMap={{}} selected={null} onSelect={() => {}}
    orientation={orientation} style={style} crossSymbolSize={12} haplotype={view} />);
  await vi.waitFor(() => expect(networks.length).toBe(1));
  networks.pop()!.body.emitter.emit("_resizeNodes");
  const geometry = ref.current!.geometry()!;
  cleanup();
  const boxes = haplotypeBoxes(model, view, THEMES[style], {}, new Set());
  return {
    model, ...geometry, colorMap: {}, haplotypeBoxes: boxes,
    founderLegend: founderAlleleLegend(data, Object.values(boxes), view.settings),
    style, orientation, crossSymbolSize: 12, ...extra,
  };
}

const parse = (svg: string) => {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  return doc;
};
const translate = (el: Element) => {
  const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(el.getAttribute("transform") ?? "")!;
  return { x: Number(m[1]), y: Number(m[2]) };
};

// ── Snapshots ─────────────────────────────────────────────────────────────────

/** The FlexQTL export, too large to keep whole (about 770 kB): its legend in
 *  full, as an SVG of its own, and a summary of the chart. */
function legendAndSummary(svg: string, width: number, height: number) {
  const doc = parse(svg);
  const block = doc.querySelector("g.founder-alleles")!;
  // Sized to the page's room from the legend's origin, so it opens whole.
  const at = translate(block);
  const legend = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width - at.x}" height="${height - at.y}" ` +
      `font-family="Noto Sans, sans-serif" font-size="11">`,
    doc.querySelector("defs")!.outerHTML,
    block.outerHTML.replace(/ transform="translate\([^)]*\)"/, ""),
    `</svg>`, "",
  ].join("\n");
  const summary = {
    page: { width, height },
    legendAt: translate(block),
    boxes: [...doc.querySelectorAll("g.node.haplotype")].map(g => {
      const r = g.querySelector("rect.haplotype-box")!;
      return { name: g.querySelector("text.individual")!.textContent, ...translate(g),
               width: Number(r.getAttribute("width")), height: Number(r.getAttribute("height")),
               segments: g.querySelectorAll("rect.segment").length };
    }),
  };
  return { legend, summary: JSON.stringify(summary, null, 1) + "\n" };
}

describe("export snapshots (Modern, white page)", () => {
  for (const c of CASES) {
    for (const orientation of ["UD", "LR"] as const) {
      it(`${c.name}, ${orientation}`, async () => {
        const { svg, width, height } = buildSvg(await exportInput(c.graph, c.data, "modern", orientation));
        const base = `__snapshots__/ibd-export/${c.name}-${orientation}`;
        if (c.name.startsWith("example")) {
          await expect(svg).toMatchFileSnapshot(`${base}.svg`);
        } else {
          const { legend, summary } = legendAndSummary(svg, width, height);
          await expect(legend).toMatchFileSnapshot(`${base}.legend.svg`);
          await expect(summary).toMatchFileSnapshot(`${base}.summary.json`);
        }
      }, 60_000);
    }
  }
});

// ── Exactly the founder alleles drawn ─────────────────────────────────────────

/** (founder, alleles) of the individuals `ids`, straight from the rows: every
 *  founder allele with a probability drawn as its own segment (at least the
 *  merge threshold of its homologue's sum). */
function expectedRows(data: HaplotypeData, ids: string[], settings = DEFAULT_HAPLOTYPE_SETTINGS) {
  const threshold = 1 / settings.barWidth;
  const alleles = new Set<number>();
  for (const id of ids) {
    for (const homologue of data.rows[id] ?? []) {
      for (const band of homologue) {
        const sum = band.reduce((s, [, p]) => s + p, 0);
        for (const [a, p] of band) if (p / sum >= threshold) alleles.add(a);
      }
    }
  }
  const byFounder = new Map<string, number[]>();
  for (const a of [...alleles].sort((x, y) => x - y)) {
    const name = data.founders![founderOf(a)];
    byFounder.set(name, [...(byFounder.get(name) ?? []), a]);
  }
  return [...byFounder.entries()];
}

function legendRows(graph: GraphData, data: HaplotypeData, ids: string[]) {
  const sub: GraphData = { ...graph, nodes: graph.nodes.filter(n => ids.includes(n.id)),
                           edges: graph.edges.filter(e => ids.includes(e.from) && ids.includes(e.to)) };
  const model = buildChartModel(sub, true);
  const view = viewOf(data, sub);
  const boxes = haplotypeBoxes(model, view, THEMES.modern, {}, new Set());
  return founderAlleleLegend(data, Object.values(boxes), view.settings);
}

describe("the legend lists exactly the founder alleles drawn", () => {
  const flexqtl = CASES[1];
  const subpop: string[] = haplotypes.flexqtl.subpop.G3_010;
  const cases: [string, GraphData, HaplotypeData, string[]][] = [
    ["Example.dat, LG A", CASES[0].graph, CASES[0].data, CASES[0].graph.nodes.map(n => n.id)],
    ["FlexQTL, LG 1, whole population", flexqtl.graph, flexqtl.data, flexqtl.graph.nodes.map(n => n.id)],
    ["FlexQTL, LG 1, subpopulation of G3_010", flexqtl.graph, flexqtl.data, subpop],
  ];
  for (const [name, graph, data, ids] of cases) {
    it(name, () => {
      const legend = legendRows(graph, data, ids);
      expect(legend.rows.map(r => [r.label, r.alleles.map(a => a.allele)])).toEqual(expectedRows(data, ids));
    });
  }

  it("FlexQTL whole population: 29 founder rows, 58 founder alleles; G3_010: 4 rows", () => {
    const whole = legendRows(flexqtl.graph, flexqtl.data, flexqtl.graph.nodes.map(n => n.id));
    expect(whole.rows).toHaveLength(29);
    expect(whole.rows.flatMap(r => r.alleles)).toHaveLength(58);
    expect(legendRows(flexqtl.graph, flexqtl.data, subpop).rows.map(r => r.label))
      .toEqual(["F002", "F003", "F010", "F018"]);
  });

  it("uses the screen's colors: each swatch is its allele's color in the palette", () => {
    const ids = flexqtl.graph.nodes.map(n => n.id);
    const { colorOf } = palette(flexqtl.data, ids, "founder");
    for (const row of legendRows(flexqtl.graph, flexqtl.data, ids).rows) {
      for (const a of row.alleles) expect(a.color).toBe(colorOf(a.allele));
    }
  });

  it("titles the group and the merge threshold, which follows the bar width", () => {
    const { graph, data } = CASES[0];
    const model = buildChartModel(graph, true);
    for (const [barWidth, t] of [[10, "0.10"], [20, "0.05"]] as const) {
      const settings = { ...DEFAULT_HAPLOTYPE_SETTINGS, barWidth };
      const boxes = haplotypeBoxes(model, viewOf(data, graph, settings), THEMES.modern, {}, new Set());
      const legend = founderAlleleLegend(data, Object.values(boxes), settings);
      expect(legend.title).toBe(`Founder alleles, linkage group A (below ${t} merged)`);
    }
  });

  it("lists the gray remainder only when a remainder is drawn", () => {
    for (const c of CASES) {
      const model = buildChartModel(c.graph, true);
      const boxes = Object.values(haplotypeBoxes(model, viewOf(c.data, c.graph), THEMES.modern, {}, new Set()));
      const drawn = boxes.some(b => b.items.some(i => i.role === "segment" && i.segment.allele === null));
      const legend = founderAlleleLegend(c.data, boxes, DEFAULT_HAPLOTYPE_SETTINGS);
      expect(legend.remainder, c.name).toBe(drawn ? "Below 0.10, merged" : null);
      const { svg } = buildSvg({ model, positions: Object.fromEntries(c.graph.nodes.map((n, i) => [n.id, { x: i * 200, y: 0 }])),
                                 colorMap: {}, haplotypeBoxes: Object.fromEntries(c.graph.nodes.map((n, i) => [n.id, boxes[i]])),
                                 founderLegend: legend, style: "modern", orientation: "LR", crossSymbolSize: 12 });
      const row = parse(svg).querySelector("g.legend-remainder");
      expect(!!row, c.name).toBe(drawn);
      if (drawn) expect(row!.querySelector("rect")!.getAttribute("fill")).toBe(REMAINDER_COLOR);
    }
  });
});

// ── Individuals without IBD rows ──────────────────────────────────────────────

describe("an individual without IBD rows", () => {
  const { graph, data } = CASES[0];
  const missing = graph.nodes[0].id;
  const rows = { ...data.rows };
  delete rows[missing];
  const partial: HaplotypeData = { ...data, rows };
  const model = buildChartModel(graph, true);
  const boxes = haplotypeBoxes(model, viewOf(partial, graph), THEMES.modern, {}, new Set());

  it("has hatched bars, on the canvas and in the SVG, and a 'No IBD data' legend row", () => {
    const box = boxes[missing];
    expect(box.items.filter(i => i.role === "no-data")).toHaveLength(2);
    expect(box.items.filter(i => i.role === "segment")).toHaveLength(0);

    // The canvas fills each bar with the hatch's gray before its stripes.
    const fills: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, p) => p === "fill" ? () => fills.push(String(t.fillStyle)) : p in t ? t[p as string] : () => undefined,
      set: (t, p, v) => { t[p as string] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
    drawHaplotypeBox(ctx, box, 0, 0, { theme: THEMES.modern, selected: false, hatched: false, radius: 4 });
    expect(fills.filter(f => f === HATCH.fill)).toHaveLength(2);

    const legend = founderAlleleLegend(partial, Object.values(boxes), DEFAULT_HAPLOTYPE_SETTINGS);
    expect(legend.noData).toBe(true);
    const { svg } = buildSvg({
      model, positions: Object.fromEntries(graph.nodes.map((n, i) => [n.id, { x: i * 200, y: 0 }])),
      colorMap: {}, haplotypeBoxes: boxes, founderLegend: legend, style: "modern", orientation: "UD", crossSymbolSize: 12,
    });
    const doc = parse(svg);
    expect(doc.querySelectorAll("rect.no-data")).toHaveLength(2);
    expect(doc.querySelector("pattern#unknown-hatch")).not.toBeNull();
    expect(doc.querySelector("g.legend-no-data text")?.textContent).toBe("No IBD data");
  });

  it("is not in the legend when every individual has rows", () => {
    const full = haplotypeBoxes(model, viewOf(data, graph), THEMES.modern, {}, new Set());
    expect(founderAlleleLegend(data, Object.values(full), DEFAULT_HAPLOTYPE_SETTINGS).noData).toBe(false);
  });
});

// ── Placement and contrast ────────────────────────────────────────────────────

describe("legend placement and contrast", () => {
  const pedigree = example.pedigree as PedigreeData;
  const trait = pedigree.traits[0];

  for (const c of CASES) {
    for (const style of ["classic", "modern"] as const) {
      for (const orientation of ["UD", "LR"] as const) {
        it(`${c.name}, ${style}, ${orientation}: beside the chart, never over it`, async () => {
          const colored = c.name.startsWith("example")
            ? { legend: buildLegend(trait, c.graph.nodes, {}) } : {};
          const input = await exportInput(c.graph, c.data, style, orientation, colored);
          for (const background of ["white", "screen"] as const) {
            const { svg, width, height } = buildSvg({ ...input, background });
            const doc = parse(svg);
            // The chart: every box as drawn.
            const nodes = [...doc.querySelectorAll("g.node.haplotype")].map(g => {
              const { x, y } = translate(g);
              const r = g.querySelector("rect.haplotype-box")!;
              return { left: x, top: y, right: x + Number(r.getAttribute("width")), bottom: y + Number(r.getAttribute("height")) };
            });
            const chart = { right: Math.max(...nodes.map(n => n.right)), bottom: Math.max(...nodes.map(n => n.bottom)) };
            const legends = [...doc.querySelectorAll("svg > g.legend")];
            expect(legends.map(g => g.getAttribute("class"))).toEqual(
              [...(colored.legend ? ["legend"] : []), "legend founder-alleles"]);  // coloring first
            for (const g of legends) {
              const { x, y } = translate(g);
              if (orientation === "UD") expect(y).toBeGreaterThanOrEqual(chart.bottom + 32);
              else expect(x).toBeGreaterThanOrEqual(chart.right + 32);
            }
            // Inside the page.
            const swatches = [...doc.querySelectorAll("g.founder-alleles rect.legend-swatch")];
            const origin = translate(legends.at(-1)!);
            for (const s of swatches) {
              expect(origin.x + Number(s.getAttribute("x")) + 12).toBeLessThanOrEqual(width);
              expect(origin.y + Number(s.getAttribute("y")) + 12).toBeLessThanOrEqual(height);
            }
            // Text readable on the page (WCAG AA), at the chart's font size or larger.
            const page = doc.querySelector("rect.background")!.getAttribute("fill")!;
            for (const t of doc.querySelectorAll("g.legend text")) {
              expect(contrastRatio(t.getAttribute("fill")!, page), `${t.textContent} on ${page}`)
                .toBeGreaterThanOrEqual(4.5);
              expect(Number(t.getAttribute("font-size") ?? THEMES[style].fontSize)).toBeGreaterThanOrEqual(THEMES[style].fontSize);
            }
          }
        }, 60_000);
      }
    }
  }

  it("FlexQTL at the right: 29 rows in two columns of at most 20", async () => {
    const input = await exportInput(CASES[1].graph, CASES[1].data, "modern", "LR");
    const doc = parse(buildSvg(input).svg);
    const rows = [...doc.querySelectorAll("g.legend-row")];
    expect(rows).toHaveLength(29);
    const columns = new Set(rows.map(r => r.querySelector("text")!.getAttribute("x")));
    expect(columns.size).toBe(2);
  }, 60_000);
});
