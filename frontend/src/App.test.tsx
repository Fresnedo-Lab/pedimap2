import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { GraphData } from "./hooks/useApi";
import { syntheticGraph } from "./test/fixtures";

// vis-network needs a real canvas; the drawing-limit decision happens before
// the canvas is created, so a stand-in shows whether the graph was drawn.
vi.mock("./components/PedigreeCanvas", async () => {
  const { forwardRef } = await import("react");
  return {
    default: forwardRef(function Canvas(props: { model: { individuals: unknown[]; crosses: unknown[] };
                                             colorMap: Record<string, string>;
                                             haplotype?: { data: { linkage_group: string } } | null }, _ref) {
      const { individuals, crosses } = props.model;
      return <div data-testid="pedigree-canvas" data-colors={JSON.stringify(props.colorMap)}
        data-haplotype={props.haplotype?.data.linkage_group ?? ""}>
        {individuals.length} drawn, {crosses.length} crosses</div>;
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

function serve(graph: GraphData, load: unknown = { loaded: "dat", individuals: 0 },
               population = "Synthetic", more: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    "/api/health":      { status: "ok", app: "pedimap2", version: "test" },
    "/api/load":        load,
    "/api/export/dat":  "PEDIGREE",
    "/api/pedigree":    { population, ploidy: 2, traits: [], markers: [] },
    "/api/individuals": graph.nodes.map(n => ({ id: n.id, name: n.label, generation: n.generation, cross_type: n.cross_type })),
    "/api/graph":       graph,
    ...more,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const where = new URL(url);
    let body = routes[where.pathname];
    // A route may answer by the request: a function of the URL, giving the
    // body, or a Response (e.g. an error).
    if (typeof body === "function") body = (body as (u: URL) => unknown)(where);
    if (body instanceof Response) return body;
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return routes;
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
  }, 30_000);   // rendering 1,001 list items can exceed the 5 s default on CI runners

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

describe("loading a file", () => {
  it("shows the warnings of a file that loaded", async () => {
    const warning = "FACTOR0 does not match the pedigree for 1 individual(s)";
    serve(pedigreeOf(4), { loaded: "dat", individuals: 4, warnings: [warning] });
    const { container } = render(<App />);
    await screen.findByTestId("pedigree-canvas");
    expect(screen.queryByRole("status", { name: "File warnings" })).toBeNull();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "b.ped")] } });
    const banner = await screen.findByRole("status", { name: "File warnings" });
    expect(banner.textContent).toContain(warning);

    fireEvent.click(within(banner).getByText("Dismiss"));
    expect(screen.queryByRole("status", { name: "File warnings" })).toBeNull();
  });
});

describe("exported file names", () => {
  it("drop a data-file extension from the population name", async () => {
    // FlexQTL and Binko write the data file's name as POPULATION.
    serve(pedigreeOf(4), undefined, "pm_small.dat");
    const url = URL as unknown as Record<string, unknown>;   // jsdom has no object URLs
    url.createObjectURL = () => "blob:x";
    url.revokeObjectURL = () => {};
    const names: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    render(<App />);
    await screen.findByTestId("pedigree-canvas");
    fireEvent.click(screen.getByText(/Export \.dat/));
    await vi.waitFor(() => expect(names).toEqual(["pm_small.dat"]));
    click.mockRestore();
    delete url.createObjectURL;
    delete url.revokeObjectURL;
  });
});

describe("color by a marker", () => {
  it("by genotype code or copies of an allele, with a legend", async () => {
    const marker = { name: "M1", linkage_group: "1", position_cM: 0 };
    serve(pedigreeOf(4), undefined, "Synthetic", {
      "/api/pedigree": { population: "Synthetic", ploidy: 2, traits: [], markers: [marker],
                         marker_summary: { loci: 1, linkage_groups: [], ibd_positions: 0, genotype_rows: 3,
                                           individuals_with_genotypes: 3, codes: [], nalleles: null,
                                           founders_named: false, flexqtl_codes: true } },
      "/api/marker-values": { marker: "M1", allele_names: ["A", "G"], values: {
        I0: { alleles: ["A", "G"], codes: [0, 0] },
        I1: { alleles: [null, null], codes: [5, 5] },
        I2: { alleles: ["A", "A"], codes: [11, 11] },
      } },
    });
    render(<App />);
    const canvas = await screen.findByTestId("pedigree-canvas");
    const colors = () => JSON.parse(canvas.getAttribute("data-colors")!);
    const legend = (title: string) =>
      [...screen.getByRole("group", { name: `Legend: ${title}` }).children].slice(1).map(e => e.textContent);

    fireEvent.change(screen.getByLabelText("Color by"), { target: { value: "\u0000genotype-code" } });
    await vi.waitFor(() => expect(legend("Genotype code at M1"))
      .toEqual(["0 · OC", "5 · IM", "11 · OPhE", "No genotype data"]));
    expect(colors().I0).not.toBe(colors().I1);
    expect(colors().I3).toBe("#6B7280");                       // no genotype row

    fireEvent.change(screen.getByLabelText("Color by"), { target: { value: "\u0000allele" } });
    await vi.waitFor(() => expect((screen.getByLabelText("Allele") as HTMLSelectElement).value).toBe("A"));
    expect(legend("Copies of allele A at M1")).toEqual(["1 copy", "2 copies", "Unknown", "No genotype data"]);
    fireEvent.change(screen.getByLabelText("Allele"), { target: { value: "G" } });
    expect(legend("Copies of allele G at M1")).toEqual(["0 copies", "1 copy", "Unknown", "No genotype data"]);

    fireEvent.change(screen.getByLabelText("Color by"), { target: { value: "" } });
    expect(screen.queryByRole("group", { name: /^Legend/ })).toBeNull();
    expect(colors()).toEqual({});
  });
});

describe("loading a new dataset", () => {
  it("closes the details panel, clears the selection, the Subpop button and the search", async () => {
    serve(pedigreeOf(4), { loaded: "dat", individuals: 4 }, "Example", {
      "/api/individual/I1": { id: "I1", name: "I1", female_parent: "I0", male_parent: null,
        cross_type: "cross", ploidy: 2, generation: 1, traits: {}, markers: {}, notes: "",
        ancestors: [], descendants: [], siblings: [], genotypes: [], ibd: [] },
    });
    const { container } = render(<App />);
    await screen.findByTestId("pedigree-canvas");

    fireEvent.change(screen.getByPlaceholderText("Search individuals…"), { target: { value: "I1" } });
    fireEvent.click(screen.getAllByText("I1")[0]);
    await screen.findByText(/Gen 1 · cross/);                      // the details panel
    expect(screen.getByText(/Subpop: I1/)).toBeTruthy();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "pm_small.dat")] } });
    await vi.waitFor(() => expect(screen.queryByText(/Gen 1 · cross/)).toBeNull());
    expect(screen.queryByText(/Subpop:/)).toBeNull();
    expect((screen.getByPlaceholderText("Search individuals…") as HTMLInputElement).value).toBe("");
  });
});

describe("IBD bars", () => {
  const summary = (ibd: number) => ({ loci: 1, ibd_positions: ibd, genotype_rows: 0,
    individuals_with_genotypes: 0, codes: [], nalleles: ibd ? 4 : null, founders_named: !!ibd,
    flexqtl_codes: false,
    linkage_groups: [{ name: "1", loci: 1, ibd_positions: ibd }, { name: "2", loci: 1, ibd_positions: 0 }] });
  const haplotypes = {
    linkage_group: "1", start_cM: 0, end_cM: 10, positions: [{ position: "0", cM: 0 }], markers: [],
    nalleles: 4, founders: ["I0", "I2"], founder_alleles: {},
    rows: { I0: [[[[1, 1]]], [[[2, 1]]]], I1: [[[[1, 1]]], [[[2, 1]]]] },
  };

  it("offers the linkage groups with IBD positions, and draws the one chosen", async () => {
    serve(pedigreeOf(4), undefined, "Synthetic", {
      "/api/pedigree": { population: "Synthetic", ploidy: 2, traits: [], markers: [], marker_summary: summary(1) },
      "/api/haplotypes": haplotypes,
    });
    render(<App />);
    const canvas = await screen.findByTestId("pedigree-canvas");
    const select = await screen.findByLabelText("IBD bars") as HTMLSelectElement;
    expect([...select.options].map(o => o.textContent)).toEqual(["Off", "Linkage group 1"]);  // not 2
    expect(canvas.getAttribute("data-haplotype")).toBe("");

    fireEvent.change(select, { target: { value: "1" } });
    await vi.waitFor(() => expect(screen.getByTestId("pedigree-canvas").getAttribute("data-haplotype")).toBe("1"));
    fireEvent.change(select, { target: { value: "" } });
    await vi.waitFor(() => expect(screen.getByTestId("pedigree-canvas").getAttribute("data-haplotype")).toBe(""));
  });

  it("is not offered for a file without IBD positions", async () => {
    serve(pedigreeOf(4), undefined, "Synthetic", {
      "/api/pedigree": { population: "Synthetic", ploidy: 2, traits: [], markers: [], marker_summary: summary(0) },
    });
    render(<App />);
    await screen.findByTestId("pedigree-canvas");
    expect(screen.queryByLabelText("IBD bars")).toBeNull();
  });
});

describe("IBD bars across dataset loads", () => {
  const groups = (names: string[], ibd: number) => ({ loci: names.length, ibd_positions: ibd * names.length,
    genotype_rows: 0, individuals_with_genotypes: 0, codes: [], nalleles: ibd ? 4 : null,
    founders_named: !!ibd, flexqtl_codes: false,
    linkage_groups: names.map(name => ({ name, loci: 1, ibd_positions: ibd })) });
  const haplotypes = (group: string) => ({
    linkage_group: group, start_cM: 0, end_cM: 10, positions: [{ position: "0", cM: 0 }], markers: [],
    nalleles: 4, founders: ["I0", "I2"], founder_alleles: {}, rows: { I0: [[[[1, 1]]], [[[2, 1]]]] },
  });
  // Like the backend: 404 for a group the loaded file has no IBD positions on.
  const haplotypesOf = (available: string[]) => (url: URL) => {
    const group = url.searchParams.get("linkage_group")!;
    return available.includes(group) ? haplotypes(group) : new Response(
      JSON.stringify({ detail: `Linkage group '${group}' has no IBD positions.` }), { status: 404 });
  };
  const requested = () => (fetch as unknown as { mock: { calls: [string][] } }).mock.calls
    .map(([u]) => new URL(u)).filter(u => u.pathname === "/api/haplotypes")
    .map(u => u.searchParams.get("linkage_group"));

  it("never asks the next file for the old group, and takes the new file's first", async () => {
    const routes = serve(pedigreeOf(4), { loaded: "dat", individuals: 4 }, "FlexQTL", {
      "/api/pedigree": { population: "FlexQTL", ploidy: 2, traits: [], markers: [], marker_summary: groups(["1", "2"], 21) },
      "/api/haplotypes": haplotypesOf(["1", "2"]),
    });
    const { container } = render(<App />);
    await screen.findByTestId("pedigree-canvas");
    fireEvent.change(await screen.findByLabelText("IBD bars"), { target: { value: "1" } });
    await vi.waitFor(() => expect(screen.getByTestId("pedigree-canvas").getAttribute("data-haplotype")).toBe("1"));
    const before = requested().length;

    // Example.dat: groups A, B and C. Group 1 must not be asked for.
    routes["/api/pedigree"] = { population: "Apples", ploidy: 2, traits: [], markers: [], marker_summary: groups(["A", "B", "C"], 3) };
    routes["/api/haplotypes"] = haplotypesOf(["A", "B", "C"]);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "Example.dat")] } });
    await vi.waitFor(() => expect(screen.getByTestId("pedigree-canvas").getAttribute("data-haplotype")).toBe("A"));
    expect(requested().slice(before)).toEqual(["A"]);
    expect((screen.getByLabelText("IBD bars") as HTMLSelectElement).value).toBe("A");
    expect(document.body.textContent).not.toMatch(/API \d|detail|no IBD positions/);

    // A file without IBD positions: the bars are off, and nothing is asked for.
    routes["/api/pedigree"] = { population: "Plain", ploidy: 2, traits: [], markers: [], marker_summary: groups(["X"], 0) };
    fireEvent.change(input, { target: { files: [new File(["x"], "plain.dat")] } });
    await vi.waitFor(() => expect(screen.queryByLabelText("IBD bars")).toBeNull());
    await vi.waitFor(() => expect(screen.getByTestId("pedigree-canvas").getAttribute("data-haplotype")).toBe(""));
    expect(requested().slice(before)).toEqual(["A"]);
  });

  it("says plainly when the IBD data cannot be loaded", async () => {
    serve(pedigreeOf(4), undefined, "FlexQTL", {
      "/api/pedigree": { population: "FlexQTL", ploidy: 2, traits: [], markers: [], marker_summary: groups(["1"], 21) },
      "/api/haplotypes": () => new Response(JSON.stringify({ detail: "boom" }), { status: 500 }),
    });
    render(<App />);
    await screen.findByTestId("pedigree-canvas");
    fireEvent.change(await screen.findByLabelText("IBD bars"), { target: { value: "1" } });
    expect(await screen.findByText(/Could not load the IBD data of linkage group 1\./)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/API \d|boom/);
  });
});
