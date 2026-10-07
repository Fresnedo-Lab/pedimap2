// Links must never pass through an individual or cross they do not connect.
// Checked on the chart the app draws: the real PedigreeCanvas lays out each
// pedigree with vis-network (on a stand-in canvas), and its routes are tested
// against every node box. The image export must write the very same routes.

import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GraphData } from "../hooks/useApi";
import { buildChartModel, type ChartModel } from "./model";
import { chartBoxes, routePolyline, svgPathData, type RoutedLink } from "./routing";
import { buildSvg } from "./svgExport";
import type { DisplayStyle } from "./style";
import { installFakeCanvas } from "../test/fakeCanvas";
import { subpopulations, violations, type Box } from "../test/linkInvariant";
import { syntheticPedigree } from "../test/syntheticPedigree";

interface RecordedNetwork {
  body: { emitter: { emit(event: string, params?: unknown): void } };
  getPositions(ids?: string[]): Record<string, { x: number; y: number }>;
  moveNode(id: string, x: number, y: number): void;
}
const networks: RecordedNetwork[] = [];
vi.mock("vis-network/standalone", async (importOriginal) => {
  const vis = await importOriginal<typeof import("vis-network/standalone")>();
  class Recorded extends vis.Network {
    constructor(...args: ConstructorParameters<typeof vis.Network>) { super(...args); networks.push(this as never); }
  }
  return { ...vis, Network: Recorded };
});
import PedigreeCanvas, {
  NOTICE_LAYOUT_NODES, layoutNodeCount, type PedigreeCanvasHandle,
} from "../components/PedigreeCanvas";

installFakeCanvas();

type Config = { style: DisplayStyle; orientation: "UD" | "LR"; crosses: boolean };
const CONFIGS: Config[] = (["classic", "modern"] as const).flatMap(style =>
  (["UD", "LR"] as const).flatMap(orientation =>
    [true, false].map(crosses => ({ style, orientation, crosses }))));
const CROSS_SIZE = 12;

/**
 * Lay out a chart as the app does and return what the canvas draws. With
 * `drag`, every individual and cross is then dragged far off its row and past
 * its neighbors (as the mouse would move it), one after another.
 */
async function drawn(graph: GraphData, c: Config, drag = false) {
  const model = buildChartModel(graph, c.crosses);
  const ref = createRef<PedigreeCanvasHandle>();
  render(<PedigreeCanvas ref={ref} model={model} colorMap={{}} selected={null} onSelect={() => {}}
    orientation={c.orientation} style={c.style} crossSymbolSize={CROSS_SIZE} />);
  // Large charts are laid out after a "Laying out…" notice has painted.
  await vi.waitFor(() => expect(networks.length).toBe(1));
  const net = networks.pop()!;
  // jsdom never paints, and fit() stops early on its zero-size canvas, so size
  // every node directly with the event fit() sends when the app frames a chart.
  net.body.emitter.emit("_resizeNodes");

  const before = net.getPositions();
  if (drag) {
    const ids = [...model.individuals.map(n => n.id), ...model.crosses.map(x => x.id)];
    ids.forEach((id, i) => {
      const params = { nodes: [id] };
      const far = (i % 2 ? 1 : -1) * 5000;
      net.body.emitter.emit("dragStart", params);
      const p = net.getPositions([id])[id];
      net.moveNode(id, p.x + far, p.y - far);                   // off the row, past everyone
      net.body.emitter.emit("dragging", params);
      net.body.emitter.emit("dragEnd", params);
    });
  }
  const geometry = ref.current!.geometry()!;
  const routes = ref.current!.routes();
  cleanup();
  return { model, geometry, routes, before };
}

function check(model: ChartModel, geometry: { positions: Record<string, { x: number; y: number }>; boxes: Record<string, Box> },
               routes: RoutedLink[]) {
  const boxes = chartBoxes(model, geometry.positions, geometry.boxes, CROSS_SIZE);
  for (const w of model.waypointIds) boxes.delete(w);         // lanes, not nodes
  return violations(routes.map(r => ({ from: r.link.from, to: r.link.to, points: routePolyline(r) })), boxes);
}

async function expectNoViolations(name: string, graphs: GraphData[], configs = CONFIGS, drag = false) {
  for (const config of configs) {
    let routed = 0;
    const found: string[] = [];
    for (const graph of graphs) {
      // Yield between charts: a long synchronous run starves vitest's worker
      // channel and it reports a timeout even though the test passes.
      await new Promise(resolve => setTimeout(resolve, 0));
      const { model, geometry, routes } = await drawn(graph, config, drag);
      expect(routes).toHaveLength(model.links.length);       // every link is drawn
      routed += routes.length;
      for (const v of check(model, geometry, routes)) found.push(`${v.from} → ${v.to} crosses ${v.crosses}`);
    }
    expect(routed).toBeGreaterThan(0);
    expect(found, `${name}, ${JSON.stringify(config)}`).toEqual([]);
  }
}

const fixture = (file: string) =>
  JSON.parse(readFileSync(resolve("src/test/fixtures", file), "utf-8")).graph as GraphData;

describe("links never cross a node they do not connect", () => {
  it("apple_public.dat: whole population and every subpopulation", async () => {
    const graph = fixture("apple_public.json");
    await expectNoViolations("apple_public", [graph, ...subpopulations(graph).map(s => s.graph)]);
  });

  it("Example.dat: whole population and every subpopulation", async () => {
    const graph = fixture("example.json");
    await expectNoViolations("Example", [graph, ...subpopulations(graph).map(s => s.graph)]);
  });
});

// The private file is never committed, so this runs only locally (skipped in
// CI). Generate its graph with `cd backend && python -m tests.test_frontend_fixture`.
const privateGraph = resolve("src/test/fixtures/private/transapple.json");
describe.skipIf(!existsSync(privateGraph))("private pedigree: whole population and every subpopulation", () => {
  const graphs = () => {
    const graph = fixture("private/transapple.json");
    return [graph, ...subpopulations(graph).map(s => s.graph)];
  };
  for (const config of CONFIGS) {
    it(`${config.style}, ${config.orientation}, cross symbols ${config.crosses ? "on" : "off"}`,
       () => expectNoViolations("private", graphs(), [config], true), 1_200_000);
  }
});

describe("dragging", () => {
  async function expectDragsKeepRows(graphs: GraphData[], configs = CONFIGS) {
    for (const config of configs) {
      const found: string[] = [];
      let moved = 0;
      for (const graph of graphs) {
        await new Promise(resolve => setTimeout(resolve, 0));
        const { model, geometry, routes, before } = await drawn(graph, config, true);
        const along = (p: { x: number; y: number }) => (config.orientation === "UD" ? p.y : p.x);
        const across = (p: { x: number; y: number }) => (config.orientation === "UD" ? p.x : p.y);
        for (const [id, p] of Object.entries(geometry.positions)) {
          expect(along(p), `${id} left its row`).toBe(along(before[id]));
          if (Math.abs(across(p) - across(before[id])) > 1) moved++;
        }
        for (const v of check(model, geometry, routes)) found.push(`${v.from} → ${v.to} crosses ${v.crosses}`);
      }
      expect(moved, "the drags moved nodes along their rows").toBeGreaterThan(0);
      expect(found, JSON.stringify(config)).toEqual([]);
    }
  }

  it("keeps every node in its row and links clear of boxes (apple_public, Example)", async () => {
    const graphs = ["apple_public.json", "example.json"].flatMap(f => {
      const graph = fixture(f);
      return [graph, ...subpopulations(graph).map(s => s.graph)];
    });
    await expectDragsKeepRows(graphs);
  });

  it("does the same on a synthetic 500-individual pedigree", async () => {
    await expectDragsKeepRows([syntheticPedigree(500)],
      [CONFIGS[0], CONFIGS.find(c => c.style === "modern" && c.orientation === "LR" && !c.crosses)!]);
  }, 300_000);
});

describe("layout notice", () => {
  const show = (graph: GraphData) => {
    const model = buildChartModel(graph, true);
    render(<PedigreeCanvas model={model} colorMap={{}} selected={null} onSelect={() => {}}
      orientation="UD" style="classic" crossSymbolSize={CROSS_SIZE} />);
    return model;
  };

  it("is painted before a large layout starts, and removed after it", async () => {
    const model = show(syntheticPedigree(1000));
    expect(layoutNodeCount(model)).toBeGreaterThanOrEqual(NOTICE_LAYOUT_NODES);
    expect(screen.getByRole("status").textContent).toBe("Laying out 1,000 individuals…");
    expect(networks).toHaveLength(0);                          // layout not started yet
    await vi.waitFor(() => expect(networks).toHaveLength(1));
    await vi.waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    networks.pop();
    cleanup();
  });

  it("is not shown for a small chart", async () => {
    show(fixture("example.json"));
    await vi.waitFor(() => expect(networks).toHaveLength(1));
    expect(screen.queryByRole("status")).toBeNull();
    networks.pop();
    cleanup();
  });
});

describe("Example.dat links reported crossing other boxes", () => {
  it("now run around Elstar and Elise", async () => {
    const graph = fixture("example.json");
    for (const config of CONFIGS) {
      const { model, geometry, routes } = await drawn(graph, config);
      const passes = (from: string, toChild: string) => routes.filter(r =>
        r.link.from === from &&
        (r.link.to === toChild || model.crosses.find(c => c.id === r.link.to)?.children.includes(toChild)));
      // Cox → Elise's cross used to cross Elstar; Elstar → 81015-045's cross, Elise.
      expect(passes("Cox", "Elise")).toHaveLength(1);
      expect(passes("Elstar", "81015-045")).toHaveLength(1);
      expect(check(model, geometry, routes)).toEqual([]);
    }
  });
});

describe("image export", () => {
  it("routes every link exactly as on screen", async () => {
    const graph = fixture("example.json");
    for (const config of CONFIGS) {
      const { model, geometry, routes } = await drawn(graph, config, true);
      const { svg } = buildSvg({ model, ...geometry, colorMap: {}, style: config.style,
                                 orientation: config.orientation, crossSymbolSize: CROSS_SIZE });
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      const exported = [...doc.querySelectorAll("g.links path")].map(p => p.getAttribute("d"));
      expect(exported).toEqual(routes.map(svgPathData));
      // One continuous path per link, keeping its role color.
      expect(doc.querySelectorAll("g.links path.link-female").length)
        .toBe(routes.filter(r => r.role === "female").length);
    }
  });
});
