// components/IbdLegend.tsx
// ========================
// The legend of the IBD bars' founder-allele colors, over the chart's lower
// left corner: the same rows as the legend of an exported image (both come
// from lib/haplotype.ts, founderAlleleLegend, over the boxes the chart
// draws). A founder's first allele is always in the first swatch column and
// its second in the second, as in the export. The title collapses it.

import { REMAINDER_COLOR, type FounderLegend } from "../lib/haplotype";
import { hatchBackground } from "./ChartLegend";

interface Props {
  legend:    FounderLegend;
  collapsed: boolean;
  onToggle:  () => void;
}

const swatch = (background: string) => (
  <span style={{ width: 12, height: 12, borderRadius: 2, background, flexShrink: 0,
    border: "1px solid rgba(0,0,0,.3)", display: "inline-block" }} />
);

export default function IbdLegend({ legend, collapsed, onToggle }: Props) {
  return (
    <div role="group" aria-label="Founder alleles"
      style={{ background: "rgba(22,27,39,0.94)", border: "1px solid #2e3a52", borderRadius: 8,
        fontSize: 11, color: "#e8ecf4", maxWidth: 320, pointerEvents: "auto",
        display: "flex", flexDirection: "column", maxHeight: "45vh" }}>
      <button onClick={onToggle} aria-expanded={!collapsed}
        title={collapsed ? "Show the legend of the founder alleles" : "Collapse the legend"}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
          background: "transparent", color: "#e8ecf4", fontSize: 11, fontWeight: 700,
          textAlign: "left", border: "none", cursor: "pointer" }}>
        <span aria-hidden style={{ color: "#94a3b8", width: 10 }}>{collapsed ? "▸" : "▾"}</span>
        {legend.title}
      </button>
      {!collapsed && (
        <div style={{ overflowY: "auto", padding: "0 10px 8px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "auto auto auto",
            columnGap: 10, rowGap: 2, alignItems: "center", justifyContent: "start" }}>
            {legend.rows.map(row => {
              const slot = (k: 0 | 1) => row.alleles.find(a => (a.allele - 1) % 2 === k);
              return [
                <span key={`${row.founder}-name`} data-founder={row.label}>{row.label}</span>,
                ...([0, 1] as const).map(k => {
                  const a = slot(k);
                  return (
                    <span key={`${row.founder}-${k}`} style={{ display: "flex", alignItems: "center", gap: 4 }}
                      data-allele={a?.allele} data-color={a?.color}>
                      {a && <>{swatch(a.color)}{a.allele}</>}
                    </span>
                  );
                }),
              ];
            })}
          </div>
          {legend.remainder && (
            <div data-remainder style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              {swatch(REMAINDER_COLOR)}{legend.remainder}
            </div>
          )}
          {legend.noData && (
            <div data-no-data style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              {swatch(hatchBackground)}No IBD data
            </div>
          )}
        </div>
      )}
    </div>
  );
}
