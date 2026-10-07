import { describe, expect, it } from "vitest";
import { ROLE_COLORS, buildChartModel, isCrossId, linkColor } from "./model";
import { appleGraph, syntheticGraph } from "../test/fixtures";

describe("chart model with cross symbols", () => {
  const model = buildChartModel(appleGraph, true);

  it("gives Jonathan one cross per mate, each with a red link from Jonathan", () => {
    const crosses = model.crosses.filter(c => c.female === "Jonathan");
    expect(crosses.map(c => c.children)).toEqual([["Idared"], ["Melrose"], ["Monroe"]]);
    for (const c of crosses) {
      const fromJonathan = model.links.filter(l => l.from === "Jonathan" && l.to === c.id);
      expect(fromJonathan).toHaveLength(1);
      expect(linkColor(fromJonathan[0].role, "#000")).toBe("#E02020");
    }
    // Jonathan's links all go to those crosses.
    expect(model.links.filter(l => l.from === "Jonathan")).toHaveLength(3);
  });

  it("draws a selfing as a single purple link without a cross", () => {
    const toChild = model.links.filter(l => l.to === "Fuji-self-01");
    expect(toChild).toEqual([{ from: "Fuji", to: "Fuji-self-01", role: "uniparental" }]);
    expect(ROLE_COLORS.uniparental).toBe("#800080");
    expect(model.crosses.some(c => c.children.includes("Fuji-self-01"))).toBe(false);
  });

  it("links the male parent in blue", () => {
    const gala = model.crosses.find(c => c.children.includes("Gala"))!;
    const male = model.links.find(l => l.from === "Golden-Delicious" && l.to === gala.id)!;
    expect(linkColor(male.role, "#000")).toBe("#2040E0");
  });

  it("puts each cross one level above its children, between the generations", () => {
    for (const c of model.crosses) {
      for (const child of c.children) expect(model.levels.get(child)).toBe(c.level + 1);
      expect(model.levels.get(c.female!)! < c.level).toBe(true);
    }
  });

  it("never lists a cross node as an individual", () => {
    expect(model.individuals.map(n => n.id)).toEqual(appleGraph.nodes.map(n => n.id));
    expect(model.individuals.some(n => isCrossId(n.id) || model.crossIds.has(n.id))).toBe(false);
    expect(model.crosses.every(c => isCrossId(c.id))).toBe(true);
  });
});

describe("full sibs", () => {
  const graph = syntheticGraph([
    ["P1", null, null], ["P2", null, null], ["P3", null, null],
    ["A", "P1", "P2"], ["B", "P1", "P2"], ["C", "P1", "P3"], ["D", "P1", null, "dh"],
  ]);
  const model = buildChartModel(graph, true);

  it("share one cross node, with one link to each child", () => {
    expect(model.crosses.map(c => c.children)).toEqual([["A", "B"], ["C"]]);
    const shared = model.crosses[0];
    expect(model.links.filter(l => l.to === shared.id).map(l => [l.from, l.role]))
      .toEqual([["P1", "female"], ["P2", "male"]]);
    expect(model.links.filter(l => l.from === shared.id).map(l => l.to)).toEqual(["A", "B"]);
  });

  it("a doubled haploid is a single purple link too", () => {
    expect(model.links.filter(l => l.to === "D")).toEqual([{ from: "P1", to: "D", role: "uniparental" }]);
  });
});

describe("without cross symbols", () => {
  it("links each parent straight to the child", () => {
    const model = buildChartModel(appleGraph, false);
    expect(model.crosses).toEqual([]);
    expect(model.links.filter(l => l.to === "Idared")).toEqual([
      { from: "Jonathan", to: "Idared", role: "female" },
      { from: "Wagener",  to: "Idared", role: "male" },
    ]);
    expect(model.links.filter(l => l.to === "Fuji-self-01")).toHaveLength(1);
  });
});
