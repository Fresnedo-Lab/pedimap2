// components/PedigreeCanvas.tsx
// ================================
// Interactive pedigree DAG powered by vis-network.
// Handles node colouring, selection, hover tooltips and layout.

import { useEffect, useRef, useCallback } from "react";
import { Network, DataSet } from "vis-network/standalone";
import type { GraphData, GraphNode, GraphEdge } from "../hooks/useApi";

export type Orientation = "UD" | "LR";

interface Props {
  graph:       GraphData;
  colorMap:    Record<string, string>;
  selected:    string | null;
  onSelect:    (id: string) => void;
  orientation: Orientation;   // "UD" = top-to-bottom, "LR" = left-to-right
}

// Hierarchical-layout config for an orientation. LR stacks same-rank nodes
// vertically, so long horizontal labels (e.g. "Cox's Orange Pippin") wrap and
// grow the node box — give LR more nodeSpacing/levelSeparation to avoid overlap.
function hierarchicalFor(orientation: Orientation) {
  const lr = orientation === "LR";
  return {
    enabled:              true,
    direction:            orientation,
    sortMethod:           "directed",
    levelSeparation:      lr ? 220 : 140,
    nodeSpacing:          lr ? 180 : 100,
    treeSpacing:          160,
    blockShifting:        true,
    edgeMinimization:     true,
    parentCentralization: true,
  };
}

// Displayed in place of an absent parent. The .dat UNKNOWN symbol is not
// currently plumbed to the frontend, so we use its default ("-") here.
const UNKNOWN_PARENT = "-";

// Build a node hover tooltip as a real DOM element.
//
// vis-network renders a string `title` as PLAIN TEXT, so an HTML string shows
// up as literal "<b>…</b>" markup. Passing an HTMLElement makes it render the
// element. We build every text node with textContent (never innerHTML), so an
// individual or trait value containing "<" or "&" cannot break the markup or
// inject content.
function buildTooltip(ind: GraphNode): HTMLElement {
  const el = document.createElement("div");
  el.className = "pedimap-tooltip";

  const name = document.createElement("strong");
  name.textContent = ind.label;
  el.appendChild(name);

  const addRow = (label: string, value: string) => {
    const row = document.createElement("div");
    row.textContent = `${label}: ${value}`;
    el.appendChild(row);
  };

  const parent = (p?: string | null) => (p && p.length > 0 ? p : UNKNOWN_PARENT);

  addRow("Female parent", parent(ind.female_parent));
  addRow("Male parent",   parent(ind.male_parent));
  addRow("Generation",    String(ind.generation));

  for (const [trait, value] of Object.entries(ind.traits ?? {})) {
    addRow(trait, String(value));
  }

  return el;
}

// Cross-type → node shape mapping
const SHAPE: Record<string, string> = {
  cross:            "ellipse",
  self:             "diamond",
  dh:               "star",
  clone:            "square",
  backcross:        "triangle",
  open_pollinated:  "hexagon",
  unknown:          "ellipse",
};

export default function PedigreeCanvas({ graph, colorMap, selected, onSelect, orientation }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef   = useRef<Network | null>(null);
  const nodesDS      = useRef(new DataSet<any>());
  const edgesDS      = useRef(new DataSet<any>());

  // ── Build vis DataSets from graph ──────────────────────────────────────────
  const buildDatasets = useCallback(() => {
    const nodes = graph.nodes.map((n: GraphNode) => ({
      id:    n.id,
      label: n.label,
      // Drive the hierarchical layout from the backend's generation field so
      // all founders share the top row, rather than letting vis-network infer
      // levels from edge topology (which scattered founders across rows).
      level: n.generation,
      x:     n.x,
      y:     n.y,
      color: {
        background: colorMap[n.id] ?? "#252e42",
        border:     n.id === selected ? "#ffffff" : "#4f9cf9",
        highlight:  { background: colorMap[n.id] ?? "#252e42", border: "#ffffff" },
        hover:      { background: colorMap[n.id] ?? "#252e42", border: "#f59e0b" },
      },
      borderWidth:          n.id === selected ? 3 : 1,
      shape:                SHAPE[n.cross_type] ?? "ellipse",
      font:                 { color: "#e8ecf4", size: 11, face: "Inter, sans-serif" },
      title:                buildTooltip(n),
      shadow:               { enabled: true, color: "rgba(0,0,0,.4)", size: 8, x: 2, y: 2 },
    }));

    const edges = graph.edges.map((e: GraphEdge) => ({
      from:   e.from,
      to:     e.to,
      arrows: { to: { enabled: true, scaleFactor: 0.6 } },
      color:  {
        color:     e.role === "female" ? "#4f9cf9" : "#10b981",
        highlight: "#ffffff",
        hover:     "#f59e0b",
        opacity:   0.75,
      },
      width:  e.role === "female" ? 1.5 : 1.5,
      dashes: e.role === "male",
      smooth: { type: "cubicBezier", forceDirection: "vertical", roundness: 0.4 },
      title:  e.role === "female" ? "Mother" : "Father",
    }));

    nodesDS.current.clear();
    edgesDS.current.clear();
    nodesDS.current.add(nodes);
    edgesDS.current.add(edges);
  }, [graph, colorMap, selected]);

  // ── Initialise network on first render ────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    buildDatasets();

    const options = {
      nodes: { size: 18, widthConstraint: { minimum: 80, maximum: 160 } },
      edges: { selectionWidth: 2 },
      layout: {
        improvedLayout: false,
        // Uses the current orientation; on a graph reload this effect re-runs
        // with the latest orientation, so the choice survives dataset changes.
        hierarchical: hierarchicalFor(orientation),
      },
      physics: { enabled: false },
      interaction: {
        hover:            true,
        tooltipDelay:     200,
        navigationButtons: false,
        keyboard:          true,
        zoomView:          true,
        dragView:          true,
      },
      configure: { enabled: false },
    };

    const network = new Network(
      containerRef.current,
      { nodes: nodesDS.current, edges: edgesDS.current },
      options,
    );
    networkRef.current = network;

    network.on("selectNode", (params) => {
      if (params.nodes.length > 0) onSelect(params.nodes[0] as string);
    });
    network.on("deselectNode", () => {/* keep panel open */});

    return () => { network.destroy(); networkRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // ── Update colours / selection without re-creating the network ────────────
  useEffect(() => {
    if (!networkRef.current) return;
    const updates = graph.nodes.map((n: GraphNode) => ({
      id:    n.id,
      color: {
        background: colorMap[n.id] ?? "#252e42",
        border:     n.id === selected ? "#ffffff" : "#4f9cf9",
        highlight:  { background: colorMap[n.id] ?? "#252e42", border: "#ffffff" },
        hover:      { background: colorMap[n.id] ?? "#252e42", border: "#f59e0b" },
      },
      borderWidth: n.id === selected ? 3 : 1,
    }));
    nodesDS.current.update(updates);
    if (selected) networkRef.current.selectNodes([selected]);
  }, [colorMap, selected, graph.nodes]);

  // ── Orientation changes: apply in place, preserving selection ─────────────
  // setOptions + stabilize re-lays out the existing network rather than
  // destroying/recreating it, so the current selection and node identities
  // survive the flip (a recreate would reset both).
  const appliedOrientation = useRef(orientation);
  useEffect(() => {
    const net = networkRef.current;
    if (!net) return;
    if (appliedOrientation.current === orientation) return; // no-op on mount
    appliedOrientation.current = orientation;
    net.setOptions({ layout: { hierarchical: hierarchicalFor(orientation) } });
    net.stabilize();
    if (selected) net.selectNodes([selected]);
  }, [orientation, selected]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", background: "#0f1117" }}
    />
  );
}
