import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { GraphData } from "./hooks/useApi";
import { syntheticGraph } from "./test/fixtures";

// vis-network needs a real canvas; the drawing-limit decision happens before
// the canvas is created, so a stand-in shows whether the graph was drawn.
vi.mock("./components/PedigreeCanvas", async () => {
  const { forwardRef } = await import("react");
  return {
    default: forwardRef(function Canvas(props: { model: { individuals: unknown[]; crosses: unknown[] } }, _ref) {
      const { individuals, crosses } = props.model;
      return <div data-testid="pedigree-canvas">{individuals.length} drawn, {crosses.length} crosses</div>;
    }),
  };
});

import App, { DEFAULT_DRAWING_LIMIT } from "./App";

/** A synthetic pedigree: `n` individuals in founder/child pairs. */
function pedigreeOf(n: number): GraphData {
  const rows: [string, string | null, string | null][] = [];
  for (let i = 0; i < n; i++) rows.push(i % 2 ? [`I${i}`, `I${i - 1}`, null] : [`I${i}`, null, null]);
  return syntheticGraph(rows);
}

function serve(graph: GraphData) {
  const routes: Record<string, unknown> = {
    "/api/health":      { status: "ok" },
    "/api/pedigree":    { population: "Synthetic", ploidy: 2, traits: [], markers: [] },
    "/api/individuals": graph.nodes.map(n => ({ id: n.id, name: n.label, generation: n.generation, cross_type: n.cross_type })),
    "/api/graph":       graph,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = routes[new URL(url).pathname];
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
}

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("drawing limit", () => {
  it("defaults to 1000 individuals", () => {
    expect(DEFAULT_DRAWING_LIMIT).toBe(1000);
  });

  it("lists a 1001-individual pedigree with a message instead of drawing it", async () => {
    serve(pedigreeOf(1001));
    render(<App />);

    const message = await screen.findByText(/more than the drawing limit of 1,000/);
    expect(message.textContent).toContain("1,001 individuals");
    expect(screen.getByText(/build a subpopulation/i)).toBeTruthy();
    expect(screen.queryByTestId("pedigree-canvas")).toBeNull();

    const list = screen.getByRole("list", { name: "Individuals" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1001);
    expect((screen.getByText(/Export image/) as HTMLButtonElement).disabled).toBe(true);
  });

  it("draws a pedigree at the limit", async () => {
    serve(pedigreeOf(1000));
    render(<App />);
    expect((await screen.findByTestId("pedigree-canvas")).textContent).toBe("1000 drawn, 0 crosses");
    expect(screen.queryByText(/more than the drawing limit/)).toBeNull();
  });

  it("follows a changed limit", async () => {
    localStorage.setItem("pedimap.settings", JSON.stringify({ drawingLimit: 2000 }));
    serve(pedigreeOf(1001));
    render(<App />);
    expect((await screen.findByTestId("pedigree-canvas")).textContent).toBe("1001 drawn, 0 crosses");
  });
});

describe("view settings", () => {
  it("upgrades settings stored before display styles existed", async () => {
    localStorage.setItem("pedimap.viewSettings", JSON.stringify({
      "view-1": { orientation: "LR", showCrossSymbols: true, crossSymbolSize: 40 },
    }));
    serve(pedigreeOf(4));
    render(<App />);
    await screen.findByTestId("pedigree-canvas");
    const stored = JSON.parse(localStorage.getItem("pedimap.viewSettings")!)["view-1"];
    expect(stored).toMatchObject({ orientation: "LR", style: "modern", crossSymbolSize: 12, traitColors: {},
                                   showCrossSymbols: { modern: false, classic: true } });
  });

  it("draws cross symbols by default in Classic style only, toggled per style", async () => {
    serve(pedigreeOf(4));                        // two founder/child pairs: 2 crosses when shown
    render(<App />);
    expect((await screen.findByTestId("pedigree-canvas")).textContent).toBe("4 drawn, 0 crosses");

    fireEvent.click(screen.getByRole("button", { name: "Classic Pedimap" }));
    expect(screen.getByTestId("pedigree-canvas").textContent).toBe("4 drawn, 2 crosses");

    fireEvent.click(screen.getByTitle("Settings"));
    fireEvent.click(screen.getByLabelText("Show cross symbols (×)"));     // off in Classic
    expect(screen.getByTestId("pedigree-canvas").textContent).toBe("4 drawn, 0 crosses");

    fireEvent.click(screen.getByRole("button", { name: "Modern" }));
    fireEvent.click(screen.getByLabelText("Show cross symbols (×)"));     // on in Modern
    expect(screen.getByTestId("pedigree-canvas").textContent).toBe("4 drawn, 2 crosses");
    expect(JSON.parse(localStorage.getItem("pedimap.viewSettings")!)["view-1"].showCrossSymbols)
      .toEqual({ modern: true, classic: false });
  });
});
