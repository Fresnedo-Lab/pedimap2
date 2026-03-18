// components/IndividualPanel.tsx
// ================================
// Side panel that shows full detail for a selected individual.

import type { IndividualDetail, TraitMeta, MarkerMeta } from "../hooks/useApi";

interface Props {
  individual:  IndividualDetail;
  traits:      TraitMeta[];
  markers:     MarkerMeta[];
  onSelectId:  (id: string) => void;
  onClose:     () => void;
}

function TraitBar({ value, meta }: { value: number | string; meta?: TraitMeta }) {
  if (!meta || meta.type === "qualitative") {
    return (
      <span style={{ fontSize: 11, color: "#a0aec0" }}>
        {value ?? "—"}
      </span>
    );
  }
  const pct = meta.max - meta.min === 0 ? 0
    : Math.max(0, Math.min(100, ((+value - meta.min) / (meta.max - meta.min)) * 100));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        flex: 1, height: 6, background: "#1e2535", borderRadius: 3, overflow: "hidden",
      }}>
        <div style={{
          width: `${pct}%`, height: "100%",
          background: `linear-gradient(90deg, ${meta.color_low}, ${meta.color_high})`,
          borderRadius: 3,
        }} />
      </div>
      <span style={{ fontSize: 11, color: "#a0aec0", minWidth: 28, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

export default function IndividualPanel({ individual: ind, traits, markers, onSelectId, onClose }: Props) {
  const traitMap  = Object.fromEntries(traits.map(t => [t.name, t]));
  const markerMap = Object.fromEntries(markers.map(m => [m.name, m]));

  const row = (label: string, val: React.ReactNode) => (
    <div key={label} style={{ display: "flex", gap: 8, padding: "3px 0",
      borderBottom: "1px solid #1e2535" }}>
      <span style={{ color: "#64748b", minWidth: 110, flexShrink: 0 }}>{label}</span>
      <span style={{ color: "#e8ecf4", wordBreak: "break-all" }}>{val}</span>
    </div>
  );

  const parentLink = (id: string | null, role: string) => {
    if (!id) return <span style={{ color: "#4b5563" }}>unknown</span>;
    return (
      <button onClick={() => onSelectId(id)} style={{
        background: "none", padding: "0 4px", color: "#4f9cf9",
        fontSize: 12, textDecoration: "underline",
      }}>
        {id}
      </button>
    );
  };

  return (
    <div style={{
      position: "absolute", right: 12, top: 52, bottom: 12,
      width: 300, background: "#161b27",
      border: "1px solid #2e3a52", borderRadius: 10,
      display: "flex", flexDirection: "column", overflow: "hidden",
      boxShadow: "0 8px 32px rgba(0,0,0,.5)", zIndex: 10,
    }}>
      {/* Header */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #2e3a52",
        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        background: "#1e2535" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{ind.name}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            Gen {ind.generation} · {ind.cross_type} · ploidy {ind.ploidy}
          </div>
        </div>
        <button onClick={onClose}
          style={{ background: "#252e42", color: "#a0aec0",
            width: 26, height: 26, borderRadius: 6, fontSize: 14 }}>
          ×
        </button>
      </div>

      {/* Scrollable body */}
      <div style={{ overflowY: "auto", flex: 1, padding: "10px 14px" }}>
        {/* Parentage */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "#4f9cf9",
          textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
          Parentage
        </div>
        {row("Mother (♀)", parentLink(ind.female_parent, "female"))}
        {row("Father (♂)", parentLink(ind.male_parent, "male"))}
        {row("Ancestors",  ind.ancestors)}
        {row("Descendants", ind.descendants)}
        {row("Siblings",   ind.siblings)}

        {/* Traits */}
        {Object.keys(ind.traits).length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#10b981",
              textTransform: "uppercase", letterSpacing: 1,
              marginTop: 14, marginBottom: 6 }}>
              Traits
            </div>
            {Object.entries(ind.traits).map(([k, v]) => (
              <div key={k} style={{ padding: "4px 0", borderBottom: "1px solid #1e2535" }}>
                <div style={{ color: "#64748b", fontSize: 11, marginBottom: 3 }}>{k}</div>
                <TraitBar value={v} meta={traitMap[k]} />
              </div>
            ))}
          </>
        )}

        {/* Markers */}
        {Object.keys(ind.markers).length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b",
              textTransform: "uppercase", letterSpacing: 1,
              marginTop: 14, marginBottom: 6 }}>
              Markers
            </div>
            {Object.entries(ind.markers).map(([mk, alleles]) => {
              const mm = markerMap[mk];
              return (
                <div key={mk} style={{ padding: "4px 0",
                  borderBottom: "1px solid #1e2535" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#e8ecf4", fontSize: 12 }}>{mk}</span>
                    {mm && (
                      <span style={{ fontSize: 10, color: "#64748b" }}>
                        {mm.linkage_group} · {mm.position_cM} cM
                      </span>
                    )}
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: 11,
                    color: "#a0aec0", marginTop: 2 }}>
                    {alleles.join(" / ")}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* Notes */}
        {ind.notes && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#8b5cf6",
              textTransform: "uppercase", letterSpacing: 1,
              marginTop: 14, marginBottom: 6 }}>
              Notes
            </div>
            <p style={{ color: "#a0aec0", fontSize: 12, lineHeight: 1.5 }}>
              {ind.notes}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
