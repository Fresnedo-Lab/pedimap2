// components/PedigreeCanvas.tsx
// ================================
// Interactive pedigree chart powered by vis-network. Draws the chart model
// (chart/model.ts) in a display style (chart/style.ts): individuals, the
// optional × cross nodes, and role-colored links. Handles selection, hover
// tooltips and layout, and hands the drawn geometry to the image export.
//
// vis-network lays out every chart node, including the invisible waypoints,
// and keeps one invisible edge per step of a link so the layout follows the
// pedigree. The visible links are drawn here from chart/routing.ts, the same
// routes the image export writes.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Network, DataSet } from "vis-network/standalone";
import type { GraphNode } from "../hooks/useApi";
import { linkColor, linkPath, type ChartModel } from "../chart/model";
import { CHART_FONT, THEMES, labelInside, type DisplayStyle, type StyleTheme } from "../chart/style";
import { CLASSIC_BOX } from "../chart/svgExport";
import {
  constrainDrag, dragRange, drawRoutes, routeLinks, routingProblems, routingWarning,
  type Box, type DragRange, type Point, type RoutedLink,
} from "../chart/routing";

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
  /** The link routes as currently drawn. */
  routes: () => RoutedLink[];
}

const FIT_ANIMATION = { duration: 400, easingFunction: "easeInOutQuad" as const };

// vis-network lays out a chart synchronously, freezing the window meanwhile.
// Its time grows with the layout nodes (individuals, crosses and waypoints):
//  - From LARGE_LAYOUT_NODES, its edge-length pass (edgeMinimization) is
//    skipped. That pass is most of the time for large charts (at 1,000
//    individuals it took about 10 s of a first layout) and shortens their
//    links by only about a tenth.
//  - From NOTICE_LAYOUT_NODES, a layout can take a second or more, so a
//    "Laying out…" notice is painted before it starts.
export const LARGE_LAYOUT_NODES  = 600;
export const NOTICE_LAYOUT_NODES = 1000;

export function layoutNodeCount(model: ChartModel): number {
  return model.individuals.length + model.crosses.length + model.waypoints.length;
}

const isLargeLayout = (model: ChartModel) => layoutNodeCount(model) >= LARGE_LAYOUT_NODES;
const needsNotice   = (model: ChartModel) => layoutNodeCount(model) >= NOTICE_LAYOUT_NODES;

// Resolve after the browser has painted the current frame.
const afterPaint = () => new Promise<void>(resolve =>
  requestAnimationFrame(() => setTimeout(resolve, 0)));

interface Props {
  model:           ChartModel;
  colorMap:        Record<string, string>;
  selected:        string | null;
  onSelect:        (id: string) => void;
  orientation:     Orientation;   // "UD" = top-to-bottom, "LR" = left-to-right
  style:           DisplayStyle;
  crossSymbolSize: number;
}

// Hierarchical-layout config. With cross symbols, individuals sit on even
// levels (2 × generation) and cross nodes on the odd level between, so each
// generation spans two levels and the separation is half the generation
// spacing; without, there is one level per generation. Waypoints take a lane
// like any node, so the node spacing also separates links from boxes.
//
// Labels are not wrapped (so the export matches the screen), so the spacing
// along the name grows with the longest name: between siblings in UD, and
// between generations in LR, where same-rank nodes stack vertically.
function hierarchicalFor(
  orientation: Orientation, longestLabel: number, levelsPerGeneration: number, large: boolean,
) {
  const lr = orientation === "LR";
  const generationSpacing = lr ? Math.max(220, longestLabel + 60) : 140;
  return {
    enabled:              true,
    direction:            orientation,
    sortMethod:           "directed",
    levelSeparation:      generationSpacing / levelsPerGeneration,
    nodeSpacing:          lr ? 60 : Math.max(100, longestLabel + 40),
    treeSpacing:          160,
    blockShifting:        true,
    edgeMinimization:     !large,
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

// Radius of the shapes drawn with their label below (vis-network `size`).
const SYMBOL_SIZE = 18;

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

// Width of a label in the chart font, measured as vis-network measures it.
let measureContext: CanvasRenderingContext2D | null | undefined;
function labelWidth(label: string, theme: StyleTheme): number {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return estimateLabel(label, theme);
  measureContext.font = `${theme.fontSize}px ${theme.fontFace}`;
  return measureContext.measureText(label).width;
}

// A waypoint is laid out but never drawn.
const invisible = () => ({ drawNode() {}, nodeDimensions: { width: 0, height: 0 } });

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

  // Link routes as drawn, and whether node geometry changed since they were
  // computed (new layout, orientation, drag, selection border).
  const routesRef = useRef<RoutedLink[]>([]);
  const stale     = useRef(true);

  // Number of individuals being laid out, while a slow layout runs.
  const [layingOut, setLayingOut] = useState<number | null>(null);

  // Links that could not be routed (drawn straight, or not drawn): warned
  // about on the chart, never left to look like real parentage.
  const [routingAlert, setRoutingAlert] = useState<string | null>(null);

  const geometry = useCallback((): ChartGeometry | null => {
    const net = networkRef.current;
    if (!net) return null;
    const positions = net.getPositions() as Record<string, Point>;
    const boxes: Record<string, Box> = {};
    for (const n of model.individuals) {
      const p = positions[n.id];
      if (!p) continue;
      const box = { ...net.getBoundingBox(n.id) };
      // vis-network places a label drawn below its symbol only when it paints
      // the node, so for nodes outside the last frame the box's horizontal
      // extent can be stale. Its vertical extent is current; take the width
      // from the symbol and the label, centered on the node.
      if (!labelInside(theme.shape(n.cross_type))) {
        const half = Math.max(SYMBOL_SIZE, labelWidth(n.label, theme) / 2);
        box.left = p.x - half;
        box.right = p.x + half;
      }
      boxes[n.id] = box;
    }
    return { positions, boxes };
  }, [model, theme]);

  const reroute = useCallback(() => {
    const g = geometry();
    if (!g) return;
    try {
      routesRef.current = routeLinks(model, g.positions, g.boxes, {
        orientation: latest.current.orientation, curved: theme.curvedLinks,
        arrows: theme.arrows, crossSymbolSize,
      });
    } catch (e) {
      console.error("Link routing failed", e);
      routesRef.current = [];
    }
    stale.current = false;
    const alert = routingWarning(routingProblems(model, routesRef.current));
    setRoutingAlert(prev => (prev === alert ? prev : alert));
  }, [geometry, model, theme, crossSymbolSize]);

  useImperativeHandle(ref, () => ({
    fit: () => networkRef.current?.fit({ animation: FIT_ANIMATION }),
    geometry,
    routes: () => { if (stale.current) reroute(); return routesRef.current; },
  }), [geometry, reroute]);

  // Select `selected` in the network, or clear the selection if it is not
  // part of the drawn graph (e.g. a relative outside the current subpopulation,
  // which vis-network would otherwise reject with "node not found").
  const applySelection = useCallback((net: Network) => {
    if (selected && nodesDS.current.get(selected)) net.selectNodes([selected]);
    else net.unselectAll();
    stale.current = true;
  }, [selected]);

  // ── Build the network for the chart model and style ───────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let network: Network | null = null;
    let cancelled = false;
    const individualIds = new Set(model.individuals.map(n => n.id));

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
            ? { widthConstraint: { minimum: CLASSIC_BOX.minWidth } } : { size: SYMBOL_SIZE }),
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
      const waypoints = model.waypoints.map(w => ({
        id:          w.id,
        level:       w.level,
        shape:       "custom",
        ctxRenderer: invisible,
        size:        0,
        chosen:      false,
      }));
      // One invisible edge per step of each link: the layout places nodes
      // along them; the visible link is drawn from its route (beforeDrawing).
      const edges = model.links.flatMap(l => {
        const path = linkPath(l);
        return path.slice(1).map((to, i) => ({ from: path[i], to }));
      });

      nodesDS.current.clear();
      edgesDS.current.clear();
      nodesDS.current.add([...individuals, ...crosses, ...waypoints]);
      edgesDS.current.add(edges);

      const longest = Math.max(0, ...model.individuals.map(n => estimateLabel(n.label, theme)));
      network = new Network(container, { nodes: nodesDS.current, edges: edgesDS.current }, {
        edges: {
          smooth:         false,
          arrows:         { to: { enabled: false } },
          color:          { opacity: 0 },
          chosen:         false,
          selectionWidth: 0,
          hoverWidth:     0,
        },
        layout: {
          improvedLayout: false,
          // Uses the current orientation; when the model or style changes this
          // effect re-runs with the latest orientation, so the choice survives.
          hierarchical: hierarchicalFor(orientation, longest, model.levelsPerGeneration, isLargeLayout(model)),
        },
        physics: { enabled: false },
        interaction: {
          hover:                true,
          tooltipDelay:         200,
          navigationButtons:    false,
          keyboard:             true,
          zoomView:             true,
          dragView:             true,
          selectConnectedEdges: false,
        },
        configure: { enabled: false },
      });
      networkRef.current = network;
      appliedOrientation.current = orientation;
      stale.current = true;

      // Links go under the nodes. Node boxes are only known once vis-network
      // has drawn them, so stale routes are recomputed after a frame and the
      // chart drawn again.
      network.on("beforeDrawing", (ctx: CanvasRenderingContext2D) =>
        drawRoutes(ctx, routesRef.current, role => linkColor(role, theme.ink)));
      network.on("afterDrawing", () => {
        if (!stale.current) return;
        reroute();
        requestAnimationFrame(() => network?.redraw());
      });
      // Dragging moves a node along its own row only, and not past its
      // neighbors there, so every link keeps a lane clear of boxes.
      let dragRanges = new Map<string, DragRange>();
      const keepInRow = (ids: string[]) => {
        for (const id of ids) {
          const range = dragRanges.get(id);
          const p = network?.getPositions([id])[id];
          if (!range || !p) continue;
          const q = constrainDrag(range, p, latest.current.orientation);
          if (q.x !== p.x || q.y !== p.y) network!.moveNode(id, q.x, q.y);
        }
        stale.current = true;
      };
      network.on("dragStart", (params: { nodes: string[] }) => {
        const g = geometry();
        dragRanges = new Map();
        if (!g) return;
        for (const id of params.nodes) {
          const range = dragRange(model, g.positions, g.boxes, id,
                                  { orientation: latest.current.orientation, crossSymbolSize });
          if (range) dragRanges.set(id, range);
        }
      });
      network.on("dragging", (params: { nodes: string[] }) => keepInRow(params.nodes));
      network.on("dragEnd",  (params: { nodes: string[] }) => { keepInRow(params.nodes); network?.redraw(); });

      // Frame the whole pedigree once it has been drawn at its real size. The
      // network is recreated for every new graph, so this also re-frames after
      // each dataset load, subpopulation and "Show All". fit() also sizes every
      // node, on screen or not, so reroute with those boxes.
      network.once("afterDrawing", () => { network?.fit(); stale.current = true; });
      network.on("animationFinished", () => { stale.current = true; network?.redraw(); });

      network.on("selectNode", (params) => {
        // Cross nodes and waypoints are drawing aids, not individuals: never
        // select one.
        const id = (params.nodes as string[]).find(n => individualIds.has(n));
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
    // Before a slow layout, show the notice and let it paint.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    const slow = needsNotice(model);
    const fontReady = fonts?.load
      ? fonts.load(`${theme.fontSize}px "${CHART_FONT}"`).then(() => {}, () => {}) : null;
    setLayingOut(slow ? model.individuals.length : null);
    if (!slow && !fontReady) create();
    else {
      Promise.all([fontReady, slow ? afterPaint() : null])
        .then(create)
        .finally(() => { if (!cancelled) setLayingOut(null); });
    }

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
    const relayout = () => {
      if (networkRef.current !== net) return;
      net.setOptions({ layout: { hierarchical: hierarchicalFor(orientation, longest, model.levelsPerGeneration, isLargeLayout(model)) } });
      stale.current = true;
      net.fit({ animation: FIT_ANIMATION });
      applySelection(net);
    };
    if (!needsNotice(model)) { relayout(); return; }
    setLayingOut(model.individuals.length);
    void afterPaint().then(relayout).finally(() => setLayingOut(null));
  }, [orientation, applySelection, model, theme]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        ref={containerRef}
        data-testid="pedigree-canvas"
        style={{ width: "100%", height: "100%", background: theme.background }}
      />
      {routingAlert && (
        <div role="alert" style={{ position: "absolute", top: 10, left: 10, right: 10,
          display: "flex", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ maxWidth: 640, padding: "8px 12px", borderRadius: 6, fontSize: 12,
            background: "#3b2a12", color: "#fcd34d", border: "1px solid #92400e",
            lineHeight: 1.45, boxShadow: "0 4px 16px rgba(0,0,0,.35)" }}>
            ⚠️ {routingAlert}
          </div>
        </div>
      )}
      {layingOut !== null && (
        <div style={{ position: "absolute", inset: 0, display: "flex",
          alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
            background: "#161b27", border: "1px solid #2e3a52", borderRadius: 8,
            color: "#a0aec0", fontSize: 13, boxShadow: "0 8px 32px rgba(0,0,0,.4)" }}>
            {/* A transform animation keeps turning while the layout blocks the page. */}
            <div aria-hidden style={{ width: 16, height: 16, border: "2px solid #252e42",
              borderTopColor: "#4f9cf9", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            Laying out {layingOut.toLocaleString("en-US")} individuals…
          </div>
        </div>
      )}
    </div>
  );
});

export default PedigreeCanvas;
