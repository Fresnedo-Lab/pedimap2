// components/PedigreeCanvas.tsx
// ================================
// Interactive pedigree DAG powered by vis-network.
// Handles node colouring, selection, hover tooltips and layout.

import { useEffect, useRef, useCallback } from "react";
import { Network, DataSet } from "vis-network/standalone";
import type { GraphData, GraphNode, GraphEdge } from "../hooks/useApi";

interface Props {
  graph:     GraphData;
  colorMap:  Record<string, string>;
  selected:  string | null;
  onSelect:  (id: string) => void;
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

export default function PedigreeCanvas({ graph, colorMap, selected, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef   = useRef<Network | null>(null);
  const nodesDS      = useRef(new DataSet<any>());
  const edgesDS      = useRef(new DataSet<any>());

  // ── Build vis DataSets from graph ──────────────────────────────────────────
  const buildDatasets = useCallback(() => {
    const nodes = graph.nodes.map((n: GraphNode) => ({
      id:    n.id,
      label: n.label,
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
      title:                `<b>${n.label}</b><br/>Gen ${n.generation} · ${n.cross_type}`,
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
        hierarchical: {
          enabled:         true,
          direction:       "UD",
          sortMethod:      "directed",
          levelSeparation: 140,
          nodeSpacing:     100,
          treeSpacing:     160,
          blockShifting:   true,
          edgeMinimization: true,
          parentCentralization: true,
        },
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

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", background: "#0f1117" }}
    />
  );
}
