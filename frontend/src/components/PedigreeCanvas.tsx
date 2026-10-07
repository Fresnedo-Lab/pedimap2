// components/PedigreeCanvas.tsx
// ================================
// Interactive pedigree chart powered by vis-network. Draws the chart model
// (chart/model.ts) in a display style (chart/style.ts): individuals, the
// optional × cross nodes, and role-colored links. Handles selection, hover
// tooltips and layout, and hands the drawn geometry to the image export.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { Network, DataSet } from "vis-network/standalone";
import type { GraphNode } from "../hooks/useApi";
import { linkColor, type ChartLink, type ChartModel, type LinkRole } from "../chart/model";
import { CHART_FONT, THEMES, labelInside, type DisplayStyle, type StyleTheme } from "../chart/style";
import { CLASSIC_BOX, type Box, type Point } from "../chart/svgExport";

export type Orientation = "UD" | "LR";

/** Node positions and drawn rectangles, for exporting what is on screen. */
export interface ChartGeometry {
  positions: Record<string, Point>;
  boxes:     Record<string, Box>;
}

// Imperative handle for the toolbar's "Fit to window" button / F shortcut and
// for the image export.
export interface PedigreeCanvasHandle {
  fit: () => void;
  geometry: () => ChartGeometry | null;
}

const FIT_ANIMATION = { duration: 400, easingFunction: "easeInOutQuad" as const };

interface Props {
  model:           ChartModel;
  colorMap:        Record<string, string>;
  selected:        string | null;
  onSelect:        (id: string) => void;
  orientation:     Orientation;   // "UD" = top-to-bottom, "LR" = left-to-right
  style:           DisplayStyle;
  crossSymbolSize: number;
}

// Hierarchical-layout config. Individuals sit on even levels (2 × generation)
// and cross nodes on the odd level between, so each generation spans two
// levels and the separation is half the generation spacing.
//
// Labels are not wrapped (so the export matches the screen), so the spacing
// along the name grows with the longest name: between siblings in UD, and
// between generations in LR, where same-rank nodes stack vertically.
function hierarchicalFor(orientation: Orientation, longestLabel: number) {
  const lr = orientation === "LR";
  return {
    enabled:              true,
    direction:            orientation,
    sortMethod:           "directed",
    levelSeparation:      lr ? Math.max(110, (longestLabel + 60) / 2) : 70,
    nodeSpacing:          lr ? 60 : Math.max(100, longestLabel + 40),
    treeSpacing:          160,
    blockShifting:        true,
    edgeMinimization:     true,
    parentCentralization: true,
  };
}

function smoothFor(theme: StyleTheme, orientation: Orientation) {
  return theme.curvedLinks
    ? { enabled: true, type: "cubicBezier", forceDirection: orientation === "UD" ? "vertical" : "horizontal", roundness: 0.4 }
    : { enabled: false };
}

// Displayed in place of an absent parent. The .dat UNKNOWN symbol is not
// currently plumbed to the frontend, so we use its default ("-") here.
const UNKNOWN_PARENT = "-";

const LINK_TITLE: Record<LinkRole, string> = {
  female:      "Female parent",
  male:        "Male parent",
  uniparental: "Single parent (selfing, doubled haploid, mutant or clone)",
  offspring:   "Offspring",
};

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

// Rough label width, only used to size the LR level spacing.
const estimateLabel = (label: string, theme: StyleTheme) => [...label].length * theme.fontSize * 0.62;

// The × of a cross node, drawn on the canvas like the export draws it.
function crossRenderer(size: number, ink: string) {
  return ({ ctx, x, y }: { ctx: CanvasRenderingContext2D; x: number; y: number }) => ({
    drawNode() {
      const h = size / 2;
      ctx.save();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x - h, y - h); ctx.lineTo(x + h, y + h);
      ctx.moveTo(x - h, y + h); ctx.lineTo(x + h, y - h);
      ctx.stroke();
      ctx.restore();
    },
    nodeDimensions: { width: size, height: size },
  });
}

function individualColors(
  n: GraphNode, theme: StyleTheme, colorMap: Record<string, string>, selected: string | null,
) {
  const fill = colorMap[n.id] ?? theme.defaultFill;
  const isSelected = n.id === selected;
  return {
    color: {
      background: fill,
      border:     isSelected ? theme.selected : theme.border,
      highlight:  { background: fill, border: theme.selected },
      hover:      { background: fill, border: theme.selected },
    },
    borderWidth: isSelected ? 3 : 1,
  };
}

const PedigreeCanvas = forwardRef<PedigreeCanvasHandle, Props>(function PedigreeCanvas(
  { model, colorMap, selected, onSelect, orientation, style, crossSymbolSize }, ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef   = useRef<Network | null>(null);
  const nodesDS      = useRef(new DataSet<any>());
  const edgesDS      = useRef(new DataSet<any>());
  const theme        = THEMES[style];

  // Latest props, read when the network is created after the chart font loads.
  const latest = useRef({ colorMap, selected, orientation, onSelect });
  latest.current = { colorMap, selected, orientation, onSelect };

  useImperativeHandle(ref, () => ({
    fit: () => networkRef.current?.fit({ animation: FIT_ANIMATION }),
    geometry: () => {
      const net = networkRef.current;
      if (!net) return null;
      const positions = net.getPositions() as Record<string, Point>;
      const boxes: Record<string, Box> = {};
      for (const n of model.individuals) {
        if (positions[n.id]) boxes[n.id] = net.getBoundingBox(n.id);
      }
      return { positions, boxes };
    },
  }), [model]);

  // Select `selected` in the network, or clear the selection if it is not
  // part of the drawn graph (e.g. a relative outside the current subpopulation,
  // which vis-network would otherwise reject with "node not found").
  const applySelection = useCallback((net: Network) => {
    if (selected && nodesDS.current.get(selected)) net.selectNodes([selected]);
    else net.unselectAll();
  }, [selected]);

  // ── Build the network for the chart model and style ───────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let network: Network | null = null;
    let cancelled = false;

    const create = () => {
      if (cancelled) return;
      const { colorMap, selected, orientation } = latest.current;
      const classic = style === "classic";

      const individuals = model.individuals.map(n => {
        const shape = theme.shape(n.cross_type);
        return {
          id:    n.id,
          label: n.label,
          level: model.levels.get(n.id),
          shape,
          ...individualColors(n, theme, colorMap, selected),
          font:  { color: theme.text, size: theme.fontSize, face: theme.fontFace },
          ...(labelInside(shape)
            ? { widthConstraint: { minimum: CLASSIC_BOX.minWidth } } : { size: 18 }),
          ...(classic && {
            // Classic Pedimap: the name on the top line of the rectangle.
            heightConstraint: { minimum: CLASSIC_BOX.minHeight, valign: "top" },
            margin:           CLASSIC_BOX.padding,
            shapeProperties:  { borderRadius: 0 },
          }),
          shadow: classic ? false : { enabled: true, color: "rgba(0,0,0,.4)", size: 8, x: 2, y: 2 },
          title:  buildTooltip(n),
        };
      });
      const crosses = model.crosses.map(c => ({
        id:          c.id,
        level:       c.level,
        shape:       "custom",
        ctxRenderer: crossRenderer(crossSymbolSize, theme.ink),
        size:        crossSymbolSize / 2,
        chosen:      false,
      }));
      const edges = model.links.map((l: ChartLink, i) => {
        const color = linkColor(l.role, theme.ink);
        return {
          id:     i,
          from:   l.from,
          to:     l.to,
          arrows: { to: { enabled: theme.arrows && !model.crossIds.has(l.to), scaleFactor: 0.6 } },
          color:  { color, highlight: color, hover: color, opacity: 1 },
          width:  1.5,
          title:  LINK_TITLE[l.role],
        };
      });

      nodesDS.current.clear();
      edgesDS.current.clear();
      nodesDS.current.add([...individuals, ...crosses]);
      edgesDS.current.add(edges);

      const longest = Math.max(0, ...model.individuals.map(n => estimateLabel(n.label, theme)));
      network = new Network(container, { nodes: nodesDS.current, edges: edgesDS.current }, {
        edges: { selectionWidth: 1, smooth: smoothFor(theme, orientation) as any },
        layout: {
          improvedLayout: false,
          // Uses the current orientation; when the model or style changes this
          // effect re-runs with the latest orientation, so the choice survives.
          hierarchical: hierarchicalFor(orientation, longest),
        },
        physics: { enabled: false },
        interaction: {
          hover:             true,
          tooltipDelay:      200,
          navigationButtons: false,
          keyboard:          true,
          zoomView:          true,
          dragView:          true,
        },
        configure: { enabled: false },
      });
      networkRef.current = network;
      appliedOrientation.current = orientation;

      // Frame the whole pedigree once it has been drawn at its real size. The
      // network is recreated for every new graph, so this also re-frames after
      // each dataset load, subpopulation and "Show All".
      network.once("afterDrawing", () => network?.fit());

      network.on("selectNode", (params) => {
        // Cross nodes are drawing aids, not individuals: never select one.
        const id = (params.nodes as string[]).find(n => !model.crossIds.has(n));
        if (id) latest.current.onSelect(id);
        else if (network) {
          const current = latest.current.selected;
          if (current && nodesDS.current.get(current)) network.selectNodes([current]);
          else network.unselectAll();
        }
      });
      network.on("deselectNode", () => {/* keep panel open */});
    };

    // Measure labels with the chart font, not a fallback: wait until it loads.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.load) fonts.load(`${theme.fontSize}px "${CHART_FONT}"`).then(create, create);
    else create();

    return () => {
      cancelled = true;
      network?.destroy();
      if (networkRef.current === network) networkRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, style, crossSymbolSize]);

  // ── Update colours / selection without re-creating the network ────────────
  useEffect(() => {
    if (!networkRef.current) return;
    nodesDS.current.update(model.individuals.map(n => ({
      id: n.id, ...individualColors(n, theme, colorMap, selected),
    })));
    applySelection(networkRef.current);
  }, [colorMap, selected, model, theme, applySelection]);

  // ── Orientation changes: apply in place, preserving selection ─────────────
  // setOptions re-lays out the existing network (synchronously) rather than
  // destroying/recreating it, so the selection and node identities survive the
  // flip. Physics is disabled, so stabilize() would do nothing and the viewport
  // would keep its old pan/zoom over a rotated layout — fit() re-frames it.
  const appliedOrientation = useRef(orientation);
  useEffect(() => {
    const net = networkRef.current;
    if (!net) return;
    if (appliedOrientation.current === orientation) return; // no-op on mount
    appliedOrientation.current = orientation;
    const longest = Math.max(0, ...model.individuals.map(n => estimateLabel(n.label, theme)));
    net.setOptions({
      layout: { hierarchical: hierarchicalFor(orientation, longest) },
      edges:  { smooth: smoothFor(theme, orientation) as any },
    });
    net.fit({ animation: FIT_ANIMATION });
    applySelection(net);
  }, [orientation, applySelection, model, theme]);

  return (
    <div
      ref={containerRef}
      data-testid="pedigree-canvas"
      style={{ width: "100%", height: "100%", background: theme.background }}
    />
  );
});

export default PedigreeCanvas;
