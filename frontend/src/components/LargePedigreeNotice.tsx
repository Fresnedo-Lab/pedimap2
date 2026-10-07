// components/LargePedigreeNotice.tsx
// ====================================
// Shown in place of the chart when the displayed graph has more individuals
// than the drawing limit: the individuals as a list, and how to draw part of
// the population (build a subpopulation around one of them).

import type { GraphNode } from "../hooks/useApi";

interface Props {
  individuals: GraphNode[];
  limit:       number;
  selected:    string | null;
  onSelect:    (id: string) => void;
  onSubpop:    () => void;
}

export default function LargePedigreeNotice({ individuals, limit, selected, onSelect, onSubpop }: Props) {
  const name = individuals.find(n => n.id === selected)?.label ?? selected;
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#0f1117" }}>
      <div role="status" style={{ padding: "14px 18px", borderBottom: "1px solid #2e3a52",
        background: "#16263f", color: "#a8c7f5", fontSize: 13, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {individuals.length.toLocaleString("en-US")} individuals is more than the drawing
          limit of {limit.toLocaleString("en-US")}, so the pedigree is listed instead of drawn.
        </div>
        Select an individual and build a subpopulation around it to draw that part of the
        pedigree. The limit can be changed in ⚙ Settings.
        {selected && (
          <div style={{ marginTop: 10 }}>
            <button onClick={onSubpop}
              style={{ background: "#1d3a6e", color: "#4f9cf9", padding: "5px 12px" }}>
              🔍 Build subpopulation around {name}
            </button>
          </div>
        )}
      </div>
      <ul aria-label="Individuals" style={{ listStyle: "none", overflowY: "auto", flex: 1,
        columnWidth: 220, columnGap: 0, padding: "6px 0" }}>
        {individuals.map(n => (
          <li key={n.id} onClick={() => onSelect(n.id)}
            style={{ padding: "4px 18px", cursor: "pointer", fontSize: 12, breakInside: "avoid",
              color: n.id === selected ? "#4f9cf9" : "#e8ecf4",
              background: n.id === selected ? "#1e2535" : "transparent",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {n.label}
            <span style={{ color: "#4b5563", fontSize: 10 }}> · Gen {n.generation}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
