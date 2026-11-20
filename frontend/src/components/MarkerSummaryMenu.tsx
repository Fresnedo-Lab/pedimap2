// components/MarkerSummaryMenu.tsx
// ================================
// "Marker data" button beside the population name: a summary of the file's
// loci, linkage groups, IBD positions and the genotype codes in use.

import { useEffect, useRef, useState } from "react";
import type { MarkerSummary } from "../hooks/useApi";
import { CODE_INFO } from "../lib/genotypeCodes";
import { CodeBadge } from "./IndividualPanel";

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export default function MarkerSummaryMenu({ summary }: { summary: MarkerSummary }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const groups = summary.linkage_groups;
  const cell = { padding: "2px 6px", borderBottom: "1px solid #1e2535", textAlign: "right" } as const;
  return (
    <div ref={root} style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} title="Marker data of this file"
        style={{ background: "#252e42", color: "#a0aec0", padding: "4px 10px", fontSize: 11 }}>
        🧬 Marker data
      </button>
      {open && (
        <div role="dialog" aria-label="Marker data"
          style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 20, width: 300,
            padding: 12, background: "#161b27", border: "1px solid #2e3a52", borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)", fontSize: 12, color: "#e8ecf4",
            display: "flex", flexDirection: "column", gap: 8, userSelect: "text" }}>
          <div style={{ fontWeight: 700 }}>
            {count(summary.loci, "locus", "loci")} on {count(groups.length, "linkage group")}
          </div>
          <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ color: "#64748b" }}>
                <th style={{ ...cell, textAlign: "left", fontWeight: 400 }}>Linkage group</th>
                <th style={{ ...cell, fontWeight: 400 }}>Loci</th>
                <th style={{ ...cell, fontWeight: 400 }}>IBD positions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.name}>
                  <td style={{ ...cell, textAlign: "left" }}>{g.name || "(no name)"}</td>
                  <td style={cell}>{g.loci}</td>
                  <td style={cell}>{g.ibd_positions}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ color: "#a0aec0" }}>
            {count(summary.genotype_rows, "genotype row")} for{" "}
            {count(summary.individuals_with_genotypes, "individual")}
            {summary.ibd_positions > 0 && (
              <>; {count(summary.ibd_positions, "IBD position")} over{" "}
                {count(summary.nalleles ?? 0, "founder allele")}
                {!summary.founders_named && " (founders not named in this file)"}</>
            )}
          </div>
          {summary.codes.length > 0 && (
            <div>
              <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>Genotype codes in use</div>
              {summary.codes.map(({ code, count: n }) => (
                <div key={code} style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 0" }}>
                  <CodeBadge code={code} flexqtl={summary.flexqtl_codes} />
                  <span style={{ flex: 1, color: "#a0aec0" }}>
                    {summary.flexqtl_codes ? CODE_INFO[code]?.short ?? "no statement" : "colour code"}
                  </span>
                  <span style={{ fontFamily: "monospace" }}>{n.toLocaleString("en-US")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
