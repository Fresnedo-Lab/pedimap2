// components/IndividualPanel.tsx
// ================================
// Side panel that shows full detail for a selected individual.
// Order: parentage, traits (what users look up most), relatives, markers, IBD,
// notes.

import { useState } from "react";
import {
  DEFAULT_PARENT_LABELS,
  type GenotypeRow, type IbdAllele, type IbdPosition, type IndividualDetail,
  type MarkerSummary, type ParentLabels, type RelativeRef, type TraitMeta,
} from "../hooks/useApi";
import { codeColor, codeTitle } from "../lib/genotypeCodes";

interface Props {
  individual:     IndividualDetail;
  traits:         TraitMeta[];
  parentLabels?:  ParentLabels;
  markerSummary?: MarkerSummary;
  onSelectId:     (id: string) => void;
  onClose:        () => void;
}

const sectionTitle = (text: string, color: string) => (
  <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase",
    letterSpacing: 1, marginTop: 14, marginBottom: 6 }}>
    {text}
  </div>
);

/** A genotype code as a small colored badge; its meaning on hover. */
export function CodeBadge({ code, flexqtl }: { code: number; flexqtl: boolean }) {
  return (
    <span title={codeTitle(code, flexqtl)} aria-label={codeTitle(code, flexqtl)} data-code={code}
      style={{ display: "inline-block", minWidth: 18, padding: "0 4px", borderRadius: 4,
        background: codeColor(code), color: "#0f1117", fontSize: 10, fontWeight: 700,
        textAlign: "center", lineHeight: "16px", cursor: "help" }}>
      {code}
    </span>
  );
}

const muted = { color: "#4b5563" };

/** Genotype rows by linkage group: locus, the two alleles in the order of the
 *  caption's parent columns, and the code (two badges if the codes differ). */
function MarkersSection({ rows, columns, flexqtl }: {
  rows: GenotypeRow[]; columns: [string, string]; flexqtl: boolean;
}) {
  if (rows.length === 0) return <div style={{ ...muted, fontSize: 12 }}>No genotype data</div>;
  const groups: [string, GenotypeRow[]][] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last[0] === r.linkage_group) last[1].push(r);
    else groups.push([r.linkage_group, [r]]);
  }
  const cell = { padding: "2px 4px", borderBottom: "1px solid #1e2535" } as const;
  return (
    <table aria-label="Genotypes" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
      <thead>
        <tr style={{ color: "#64748b", textAlign: "left" }}>
          <th style={{ ...cell, fontWeight: 400 }}>Locus</th>
          <th style={{ ...cell, fontWeight: 400 }}>{columns[0]}</th>
          <th style={{ ...cell, fontWeight: 400 }}>{columns[1]}</th>
          <th style={{ ...cell, fontWeight: 400 }}>Code</th>
        </tr>
      </thead>
      {groups.map(([group, members]) => (
        <tbody key={group} aria-label={`Linkage group ${group || "(none)"}`}>
          <tr>
            <td colSpan={4} style={{ padding: "6px 4px 2px", color: "#f59e0b", fontSize: 10 }}>
              {group ? `Linkage group ${group}` : "Not on the map"}
            </td>
          </tr>
          {members.map(r => (
            <tr key={r.marker} data-marker={r.marker}>
              <td style={{ ...cell, color: "#e8ecf4" }}
                title={r.position_cM !== null ? `${r.position_cM} cM` : undefined}>
                {r.marker}
              </td>
              {[0, 1].map(k => (
                <td key={k} style={{ ...cell, fontFamily: "monospace", color: "#a0aec0" }}>
                  {r.alleles[k] ?? <span style={muted} title="Unknown allele">–</span>}
                </td>
              ))}
              <td style={cell}>
                {[...new Set(r.codes)].map(c => <CodeBadge key={c} code={c} flexqtl={flexqtl} />)}
              </td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}

const percent = (p: number) => p.toFixed(2);

function IbdAlleleLine({ a, second }: { a: IbdAllele; second?: boolean }) {
  return (
    <div style={{ fontSize: second ? 11 : 12, color: second ? "#a0aec0" : "#e8ecf4",
      display: "flex", gap: 6 }}>
      <span style={{ minWidth: 34, textAlign: "right", fontFamily: "monospace" }}>
        {percent(a.probability)}
      </span>
      <span>
        {a.founder ? <>{a.founder} · </> : null}
        <span style={{ color: "#64748b" }}>founder allele {a.allele}</span>
      </span>
    </div>
  );
}

/** The likely founder alleles of each homologue at a chosen IBD position. */
function IbdSection({ positions, columns }: { positions: IbdPosition[]; columns: [string, string] }) {
  const groups = [...new Set(positions.map(p => p.linkage_group))];
  const [group, setGroup] = useState<string | undefined>(groups[0]);
  const inGroup = positions.filter(p => p.linkage_group === group);
  const [position, setPosition] = useState<string | undefined>(inGroup[0]?.position);
  const shown = inGroup.find(p => p.position === position) ?? inGroup[0];
  const select = { fontSize: 11, padding: "2px 4px" } as const;
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <label style={{ fontSize: 11, color: "#64748b", display: "flex", gap: 4, alignItems: "center" }}>
          Linkage group
          <select aria-label="IBD linkage group" value={group} style={select}
            onChange={e => {
              setGroup(e.target.value);
              setPosition(positions.find(p => p.linkage_group === e.target.value)?.position);
            }}>
            {groups.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: "#64748b", display: "flex", gap: 4, alignItems: "center" }}>
          Position
          <select aria-label="IBD position" value={shown?.position} style={select}
            onChange={e => setPosition(e.target.value)}>
            {inGroup.map(p => <option key={p.position} value={p.position}>{p.position} cM</option>)}
          </select>
        </label>
      </div>
      {shown?.homologues.map((alleles, h) => (
        <div key={h} aria-label={`Homologue from ${columns[h] ?? `parent ${h + 1}`}`}
          style={{ padding: "3px 0", borderBottom: "1px solid #1e2535" }}>
          <div style={{ color: "#64748b", fontSize: 11, marginBottom: 2 }}>
            Homologue from {(columns[h] ?? `parent ${h + 1}`).toLowerCase()}
          </div>
          {alleles.map((a, k) => <IbdAlleleLine key={a.allele} a={a} second={k > 0} />)}
        </div>
      ))}
    </div>
  );
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

// A relative count ("231 descendants") that expands into a list of links,
// one per line. Collapsed by default so long lists never push other sections
// out of view; the expanded list scrolls on its own.
function RelativeList({ singular, plural, people, onSelectId }: {
  singular:   string;
  plural:     string;
  people:     RelativeRef[];
  onSelectId: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = `${people.length} ${people.length === 1 ? singular : plural}`;

  if (people.length === 0) {
    return (
      <div style={{ padding: "3px 0 3px 16px", borderBottom: "1px solid #1e2535",
        color: "#4b5563", fontSize: 12 }}>
        {label}
      </div>
    );
  }
  return (
    <div style={{ borderBottom: "1px solid #1e2535" }}>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ display: "flex", alignItems: "center", gap: 6, width: "100%",
          background: "none", padding: "3px 0", color: "#e8ecf4", fontSize: 12,
          textAlign: "left", borderRadius: 0 }}>
        <span style={{ color: "#64748b", width: 10 }}>{open ? "▾" : "▸"}</span>
        {label}
      </button>
      {open && (
        <div style={{ maxHeight: 220, overflowY: "auto", padding: "0 0 6px 16px" }}>
          {people.map(p => (
            <button key={p.id} onClick={() => onSelectId(p.id)}
              title={p.name !== p.id ? p.id : undefined}
              style={{ display: "block", background: "none", padding: "1px 0",
                color: "#4f9cf9", fontSize: 12, textDecoration: "underline",
                textAlign: "left" }}>
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function IndividualPanel({
  individual: ind, traits, parentLabels = DEFAULT_PARENT_LABELS, markerSummary, onSelectId, onClose,
}: Props) {
  const traitMap  = Object.fromEntries(traits.map(t => [t.name, t]));
  const hasMarkerData = (markerSummary?.loci ?? 0) > 0 || (ind.genotypes?.length ?? 0) > 0;

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
        {row(parentLabels.female, parentLink(ind.female_parent, "female"))}
        {row(parentLabels.male, parentLink(ind.male_parent, "male"))}

        {/* Traits — directly under the parents, above anything that can grow */}
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

        {/* Relatives — counts that expand into clickable lists */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "#4f9cf9",
          textTransform: "uppercase", letterSpacing: 1,
          marginTop: 14, marginBottom: 6 }}>
          Relatives
        </div>
        <RelativeList singular="ancestor"   plural="ancestors"
          people={ind.ancestors}   onSelectId={onSelectId} />
        <RelativeList singular="descendant" plural="descendants"
          people={ind.descendants} onSelectId={onSelectId} />
        <RelativeList singular="sibling"    plural="siblings"
          people={ind.siblings}    onSelectId={onSelectId} />

        {/* Markers: genotype rows by linkage group */}
        {hasMarkerData && (
          <section aria-label="Markers">
            {sectionTitle("Markers", "#f59e0b")}
            <MarkersSection rows={ind.genotypes ?? []} columns={parentLabels.columns}
              flexqtl={markerSummary?.flexqtl_codes ?? false} />
          </section>
        )}

        {/* IBD: likely founder alleles per homologue at a chosen position */}
        {(ind.ibd?.length ?? 0) > 0 && (
          <section aria-label="IBD">
            {sectionTitle("IBD", "#22d3ee")}
            <IbdSection positions={ind.ibd!} columns={parentLabels.columns} />
          </section>
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
