// A link that cannot be routed is never drawn silently: the router flags it,
// and both the chart and the export dialog warn about it.

import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { buildChartModel, gridLayout } from "./model";
import { routeLinks, routingProblems, routingWarning } from "./routing";
import { appleGala } from "../test/fixtures";
import { installFakeCanvas } from "../test/fakeCanvas";

// Rows squeezed onto one line: no empty space between them to route through.
function squeezed(model: ReturnType<typeof buildChartModel>) {
  const positions = gridLayout(model, { level: 0, sibling: 160 });
  const boxes = Object.fromEntries(model.individuals.map(n => {
    const p = positions[n.id];
    return [n.id, { left: p.x - 40, right: p.x + 40, top: p.y - 15, bottom: p.y + 15 }];
  }));
  return { positions, boxes };
}

const opts = { orientation: "UD" as const, curved: false, arrows: false, crossSymbolSize: 12 };

describe("routing problems", () => {
  it("are none on a normal layout", () => {
    const model = buildChartModel(appleGala, true);
    const positions = gridLayout(model);
    const boxes = Object.fromEntries(model.individuals.map(n => {
      const p = positions[n.id];
      return [n.id, { left: p.x - 40, right: p.x + 40, top: p.y - 15, bottom: p.y + 15 }];
    }));
    const routes = routeLinks(model, positions, boxes, opts);
    expect(routes.every(r => !r.straight)).toBe(true);
    expect(routingWarning(routingProblems(model, routes))).toBeNull();
  });

  it("flag links drawn straight because rows overlap", () => {
    const model = buildChartModel(appleGala, true);
    const { positions, boxes } = squeezed(model);
    const routes = routeLinks(model, positions, boxes, opts);
    const problems = routingProblems(model, routes);
    expect(problems.straight).toBe(model.links.length);
    expect(routingWarning(problems)).toMatch(/^\d+ links could not be routed clear of other individuals/);
  });

  it("count links that cannot be drawn at all", () => {
    const model = buildChartModel(appleGala, true);
    const { positions, boxes } = squeezed(model);
    delete positions["Gala"];
    const routes = routeLinks(model, positions, boxes, opts);
    const missing = model.links.filter(l => [l.from, l.to].includes("Gala")).length;
    expect(routingProblems(model, routes).missing).toBe(missing);
    expect(routingWarning(routingProblems(model, routes))).toContain(`${missing} links could not be drawn.`);
  });
});

describe("the export dialog", () => {
  it("warns before saving when links cannot be routed", async () => {
    const { default: ExportImageDialog } = await import("../components/ExportImageDialog");
    const model = buildChartModel(appleGala, true);
    const geometry = squeezed(model);
    render(<ExportImageDialog baseName="test" scope="the test chart" onClose={() => {}}
      buildInput={() => ({ model, ...geometry, colorMap: {}, style: "classic",
                           orientation: "UD", crossSymbolSize: 12 })} />);
    expect(screen.getByRole("alert").textContent).toMatch(
      /could not be routed clear of other individuals.*The exported image will show them the same way/);
    cleanup();
  });
});

describe("the chart", () => {
  it("warns on screen when links cannot be routed", async () => {
    // Make every route fall back, as overlapping rows would.
    vi.doMock("./routing", async (importOriginal) => {
      const routing = await importOriginal<typeof import("./routing")>();
      return { ...routing,
        routeLinks: (...args: Parameters<typeof routing.routeLinks>) =>
          routing.routeLinks(...args).map(r => ({ ...r, straight: true })) };
    });
    vi.resetModules();
    installFakeCanvas();
    const { default: PedigreeCanvas } = await import("../components/PedigreeCanvas");
    const model = buildChartModel(appleGala, true);
    const ref = createRef<import("../components/PedigreeCanvas").PedigreeCanvasHandle>();
    render(<PedigreeCanvas ref={ref} model={model} colorMap={{}} selected={null} onSelect={() => {}}
      orientation="UD" style="classic" crossSymbolSize={12} />);
    await vi.waitFor(() => expect(ref.current?.geometry()).toBeTruthy());
    ref.current!.routes();                                    // route, as after the first frame
    expect((await screen.findByRole("alert")).textContent)
      .toContain(`${model.links.length} links could not be routed clear of other individuals`);
    cleanup();
    vi.doUnmock("./routing");
  });
});
