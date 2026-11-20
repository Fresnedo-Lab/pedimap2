// Hovering a band of the haplotype display names the founder allele, its
// founder and the probability (docs/design/haplotype-display.md, §9).
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GraphData } from "../hooks/useApi";
import { buildChartModel } from "../chart/model";
import { THEMES } from "../chart/style";
import { installFakeCanvas } from "../test/fakeCanvas";
import { DEFAULT_HAPLOTYPE_SETTINGS, palette, type HaplotypeData } from "../lib/haplotype";

interface RecordedNetwork {
  body: { emitter: { emit(event: string): void } };
  getPositions(): Record<string, { x: number; y: number }>;
  DOMtoCanvas(p: { x: number; y: number }): { x: number; y: number };
}
const networks: RecordedNetwork[] = [];
vi.mock("vis-network/standalone", async (importOriginal) => {
  const vis = await importOriginal<typeof import("vis-network/standalone")>();
  class Recorded extends vis.Network {
    constructor(...args: ConstructorParameters<typeof vis.Network>) { super(...args); networks.push(this as never); }
  }
  return { ...vis, Network: Recorded };
});
import PedigreeCanvas, { haplotypeBoxes, type HaplotypeView } from "./PedigreeCanvas";

installFakeCanvas();

const read = (f: string) => JSON.parse(readFileSync(resolve("src/test/fixtures", f), "utf-8"));

describe("hovering a haplotype box", () => {
  it("names the founder allele, its founder and the probability of a band", async () => {
    const graph = read("sim_small.json").graph as GraphData;
    const data = read("haplotypes.json").flexqtl.groups["1"] as HaplotypeData;
    const view: HaplotypeView = { data, settings: DEFAULT_HAPLOTYPE_SETTINGS, columns: ["Parent 1", "Parent 2"],
      colorOf: palette(data, graph.nodes.map(n => n.id), "founder").colorOf };
    const model = buildChartModel(graph, true);
    const { container } = render(<PedigreeCanvas model={model} colorMap={{}} selected={null} onSelect={() => {}}
      orientation="UD" style="classic" crossSymbolSize={12} haplotype={view}
      parentLabels={{ female: "Parent 1", male: "Parent 2", columns: ["Parent 1", "Parent 2"] }} />);
    await vi.waitFor(() => expect(networks.length).toBe(1));
    const net = networks.pop()!;
    // jsdom's canvas has no size, so vis-network cannot map screen to chart
    // coordinates; take them as equal (the container sits at 0, 0).
    net.DOMtoCanvas = q => q;

    // G1_001's first homologue, first band (0.000 cM): founder allele 23 at 0.95.
    const box = haplotypeBoxes(model, view, THEMES.classic, {}, new Set()).G1_001;
    const segment = box.items.find(i => i.role === "segment" && i.homologue === 0 && i.band === 0)!;
    if (segment.kind !== "rect") throw new Error("not a segment");
    const p = net.getPositions().G1_001;
    const at = (x: number, y: number) => ({ x: p.x - box.width / 2 + x, y: p.y - box.height / 2 + y });
    const target = at(segment.x + segment.w / 2, segment.y + segment.h / 2);
    const surface = container.firstElementChild as HTMLElement;
    fireEvent.mouseMove(surface, { clientX: target.x, clientY: target.y });
    expect(screen.getByRole("tooltip").textContent).toBe(
      "LG 1, 0.000 cM · homologue from parent 1 · founder allele 23 (F003) · 0.95");

    // The name row: the individual, as the tooltip of a name-only chart.
    const name = at(box.width / 2, 4);
    fireEvent.mouseMove(surface, { clientX: name.x, clientY: name.y });
    expect(screen.getByRole("tooltip").textContent).toMatch(/^G1_001\nParent 1: F003\nParent 2: F010/);

    fireEvent.mouseLeave(surface);
    expect(screen.queryByRole("tooltip")).toBeNull();
    cleanup();
  });
});
