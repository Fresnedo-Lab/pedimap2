// The on-screen legend of the founder alleles shows what the legend of an
// exported image shows: the same founders, founder alleles and colors, in the
// same order, the same title, and the same extra rows.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import IbdLegend from "./IbdLegend";
import { haplotypeBoxes, type HaplotypeView } from "./PedigreeCanvas";
import { buildChartModel, gridLayout } from "../chart/model";
import { buildSvg } from "../chart/svgExport";
import { THEMES } from "../chart/style";
import { installFakeCanvas } from "../test/fakeCanvas";
import { DEFAULT_HAPLOTYPE_SETTINGS, founderAlleleLegend, palette, REMAINDER_COLOR, type HaplotypeData } from "../lib/haplotype";
import type { GraphData } from "../hooks/useApi";

installFakeCanvas();
afterEach(cleanup);

const read = (f: string) => JSON.parse(readFileSync(resolve("src/test/fixtures", f), "utf-8"));
const graph: GraphData = read("sim_small.json").graph;
const data: HaplotypeData = read("haplotypes.json").flexqtl.groups["1"];

function legendAndSvg(scheme: "founder" | "allele") {
  const view: HaplotypeView = { data, settings: DEFAULT_HAPLOTYPE_SETTINGS, columns: ["Parent 1", "Parent 2"],
    colorOf: palette(data, graph.nodes.map(n => n.id), scheme).colorOf };
  const model = buildChartModel(graph, true);
  const boxes = haplotypeBoxes(model, view, THEMES.modern, {}, new Set());
  const legend = founderAlleleLegend(data, Object.values(boxes), view.settings);
  const { svg } = buildSvg({ model, positions: gridLayout(model), colorMap: {}, haplotypeBoxes: boxes,
    founderLegend: legend, style: "modern", orientation: "UD", crossSymbolSize: 12 });
  return { legend, svg: new DOMParser().parseFromString(svg, "image/svg+xml") };
}

describe("the on-screen legend matches the exported image's", () => {
  for (const scheme of ["founder", "allele"] as const) {
    it(`FlexQTL fixture, LG 1, by ${scheme}`, () => {
      const { legend, svg } = legendAndSvg(scheme);
      render(<IbdLegend legend={legend} collapsed={false} onToggle={() => {}} />);
      const group = screen.getByRole("group", { name: "Founder alleles" });

      expect(within(group).getByRole("button").textContent).toContain(
        svg.querySelector("g.founder-alleles text.legend-title")!.textContent);

      const onScreen = [...group.querySelectorAll("[data-founder]")].map(name => {
        const cells = [name.nextElementSibling!, name.nextElementSibling!.nextElementSibling!];
        return [name.getAttribute("data-founder"),
          cells.filter(c => c.getAttribute("data-allele")).map(c => [c.getAttribute("data-allele"), c.getAttribute("data-color")])];
      });
      const exported = [...svg.querySelectorAll("g.founder-alleles g.legend-row")].map(row => [
        row.getAttribute("data-founder"),
        [...row.querySelectorAll("rect[data-allele]")].map(r => [r.getAttribute("data-allele"), r.getAttribute("fill")])]);
      expect(onScreen).toEqual(exported);
      expect(onScreen).toHaveLength(29);

      expect(!!group.querySelector("[data-remainder]")).toBe(!!svg.querySelector("g.legend-remainder"));
      if (legend.remainder) {
        expect(group.querySelector("[data-remainder]")!.textContent).toBe(legend.remainder);
        expect(svg.querySelector("g.legend-remainder rect")!.getAttribute("fill")).toBe(REMAINDER_COLOR);
      }
    });
  }

  it("collapses to its title", () => {
    const { legend } = legendAndSvg("founder");
    const onToggle = vi.fn();
    const { rerender } = render(<IbdLegend legend={legend} collapsed={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(<IbdLegend legend={legend} collapsed={true} onToggle={onToggle} />);
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByText(/^F0\d\d$/)).toHaveLength(0);
    expect(screen.getByRole("button").textContent).toContain(legend.title);
  });
});
