// components/ChartLegend.tsx
// ==========================
// The legend of a discrete coloring, in the legend stack over the chart's
// lower-left corner (App.tsx). The image export writes the same legend
// (chart/svgExport.ts).

import { HATCH, type Legend } from "../chart/svgExport";

/** The CSS of a hatched swatch, as the chart and the export draw it. */
export const hatchBackground =
  `repeating-linear-gradient(45deg, ${HATCH.ink} 0 ${HATCH.width}px, ` +
  `${HATCH.fill} ${HATCH.width}px ${HATCH.spacing}px)`;

export default function ChartLegend({ legend }: { legend: Legend }) {
  if (legend.kind !== "discrete") return null;
  return (
    <div role="group" aria-label={`Legend: ${legend.trait}`}
      style={{ maxWidth: 260,
        background: "rgba(22,27,39,0.92)", border: "1px solid #2e3a52", borderRadius: 8,
        padding: "8px 10px", fontSize: 11, color: "#e8ecf4", pointerEvents: "none" }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{legend.trait}</div>
      {legend.entries.map(e => (
        <div key={e.label} style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 0" }}>
          <span data-hatch={e.hatch ? "" : undefined}
            style={{ width: 12, height: 12, borderRadius: 2,
              background: e.hatch ? hatchBackground : e.color,
              border: "1px solid rgba(0,0,0,.3)", flexShrink: 0 }} />
          {e.label}
        </div>
      ))}
    </div>
  );
}
