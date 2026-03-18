// App.tsx
// ========
// Root component for Pedimap 2.
// Layout:  TopBar | [Sidebar | Canvas | DetailPanel]

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  useApi, useFetch,
  type GraphData, type PedigreeData,
  type IndividualDetail, type IndividualSummary,
} from "./hooks/useApi";
import PedigreeCanvas from "./components/PedigreeCanvas";
import IndividualPanel from "./components/IndividualPanel";

// ── Helpers ───────────────────────────────────────────────────────────────────

function isTauri() {
  return typeof (window as any).__TAURI__ !== "undefined";
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100%", gap: 12, color: "#4f9cf9" }}>
      <div style={{ width: 36, height: 36, border: "3px solid #252e42",
        borderTopColor: "#4f9cf9", borderRadius: "50%",
        animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <span style={{ color: "#64748b", fontSize: 12 }}>Loading pedigree…</span>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const api = useApi();

  // ── Server data ───────────────────────────────────────────────────────────
  const { data: pedigree, reload: reloadPedigree } =
    useFetch<PedigreeData>(() => api.getPedigree());

  const [graphData,  setGraphData]  = useState<GraphData | null>(null);
  const [colorMap,   setColorMap]   = useState<Record<string, string>>({});
  const [activeTrait, setActiveTrait] = useState<string>("");

  // Fetch graph + colours whenever pedigree changes
  const [graphLoading, setGraphLoading] = useState(true);
  const loadGraph = useCallback(async (trait?: string) => {
    setGraphLoading(true);
    try {
      const [g, cm] = await Promise.all([
        api.getGraph(),
        api.getColorMap(trait ?? activeTrait),
      ]);
      setGraphData(g);
      setColorMap(cm);
    } finally {
      setGraphLoading(false);
    }
  }, [api, activeTrait]);

  // Initialise once
  useState(() => { loadGraph(); });

  // ── Selection ─────────────────────────────────────────────────────────────
  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [selectedDetail, setDetail]       = useState<IndividualDetail | null>(null);

  const handleSelect = useCallback(async (id: string) => {
    setSelectedId(id);
    try { setDetail(await api.getIndividual(id)); }
    catch { /* silently ignore */ }
  }, [api]);

  // ── Trait colouring ───────────────────────────────────────────────────────
  const handleTraitChange = useCallback(async (name: string) => {
    setActiveTrait(name);
    const cm = await api.getColorMap(name);
    setColorMap(cm);
  }, [api]);

  // ── File open ─────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenFile = useCallback(async () => {
    if (isTauri()) {
      try {
        const path = await invoke<string>("open_file_dialog");
        if (!path) return;
        // Read via Tauri fs command then POST to backend
        const content = await invoke<string>("read_file", { path });
        const fname   = path.split(/[\\/]/).pop() ?? "file.json";
        const blob    = new Blob([content], { type: "text/plain" });
        const file    = new File([blob], fname);
        await api.loadFile([file]);
        reloadPedigree();
        await loadGraph();
      } catch (e) {
        console.error(e);
      }
    } else {
      fileInputRef.current?.click();
    }
  }, [api, loadGraph, reloadPedigree]);

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    try {
      await api.loadFile(files);
      reloadPedigree();
      await loadGraph();
    } catch (err) {
      alert(String(err));
    }
    e.target.value = "";
  }, [api, loadGraph, reloadPedigree]);

  // ── Subpopulation ─────────────────────────────────────────────────────────
  const handleSubpop = useCallback(async () => {
    if (!selectedId) return;
    const g = await api.buildSubpop({
      focal_id: selectedId, ancestors: true, descendants: true, siblings: false,
    });
    setGraphData(g);
    const cm = await api.getColorMap(activeTrait);
    setColorMap(cm);
  }, [api, selectedId, activeTrait]);

  const handleReset = useCallback(async () => {
    await api.reset();
    reloadPedigree();
    await loadGraph();
    setSelectedId(null); setDetail(null);
  }, [api, loadGraph, reloadPedigree]);

  // ── Search filter ─────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const { data: indList } = useFetch<IndividualSummary[]>(() => api.listIndividuals(), []);
  const filtered = (indList ?? []).filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    i.id.toLowerCase().includes(search.toLowerCase())
  );

  // ── Render ────────────────────────────────────────────────────────────────
  const traits = pedigree?.traits ?? [];
  const markers = pedigree?.markers ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column",
      height: "100vh", overflow: "hidden", background: "#0f1117" }}>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div style={{ height: 44, display: "flex", alignItems: "center",
        padding: "0 14px", gap: 10,
        background: "#161b27", borderBottom: "1px solid #2e3a52",
        flexShrink: 0, userSelect: "none" }}>

        <span style={{ fontWeight: 800, fontSize: 15, color: "#4f9cf9",
          letterSpacing: -0.5, marginRight: 6 }}>
          🌿 Pedimap 2
        </span>

        <button onClick={handleOpenFile}
          style={{ background: "#252e42", color: "#e8ecf4", padding: "5px 12px" }}>
          📂 Open File
        </button>

        <button onClick={handleReset}
          style={{ background: "#252e42", color: "#a0aec0", padding: "5px 12px" }}>
          ↺ Demo Data
        </button>

        {traits.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
            <span style={{ color: "#64748b", fontSize: 11 }}>Colour by:</span>
            <select value={activeTrait} onChange={e => handleTraitChange(e.target.value)}
              style={{ width: 160 }}>
              <option value="">None</option>
              {traits.map(t => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>
        )}

        {selectedId && (
          <button onClick={handleSubpop}
            style={{ background: "#1d3a6e", color: "#4f9cf9", padding: "5px 12px" }}>
            🔍 Subpop: {selectedId}
          </button>
        )}

        {selectedId && graphData && graphData.nodes.length < (indList?.length ?? 0) && (
          <button onClick={loadGraph}
            style={{ background: "#252e42", color: "#a0aec0", padding: "5px 12px" }}>
            Show All
          </button>
        )}

        <div style={{ flex: 1 }} />
        <span style={{ color: "#4b5563", fontSize: 11 }}>
          {pedigree?.population ?? ""}
          {pedigree ? ` · ${graphData?.nodes?.length ?? 0} individuals` : ""}
        </span>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>

        {/* Sidebar */}
        <div style={{ width: 220, flexShrink: 0, display: "flex",
          flexDirection: "column", background: "#161b27",
          borderRight: "1px solid #2e3a52", overflow: "hidden" }}>

          <div style={{ padding: "8px 10px", borderBottom: "1px solid #2e3a52" }}>
            <input
              placeholder="Search individuals…"
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ width: "100%", fontSize: 11 }}
            />
          </div>

          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.map(ind => (
              <div
                key={ind.id}
                onClick={() => handleSelect(ind.id)}
                style={{
                  padding: "6px 10px", cursor: "pointer",
                  background: selectedId === ind.id ? "#1e2535" : "transparent",
                  borderBottom: "1px solid #1a2030",
                  borderLeft: selectedId === ind.id ? "3px solid #4f9cf9" : "3px solid transparent",
                  transition: "background .1s",
                }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: "#e8ecf4" }}
                  className="truncate">{ind.name}</div>
                <div style={{ fontSize: 10, color: "#4b5563", marginTop: 1 }}>
                  Gen {ind.generation} · {ind.cross_type}
                </div>
              </div>
            ))}
          </div>

          {/* Legend */}
          {traits.length > 0 && activeTrait && (
            <div style={{ padding: "10px 12px", borderTop: "1px solid #2e3a52",
              flexShrink: 0 }}>
              {(() => {
                const t = traits.find(tr => tr.name === activeTrait);
                if (!t) return null;
                if (t.type === "qualitative") return (
                  <div>
                    <div style={{ fontSize: 10, color: "#64748b",
                      marginBottom: 6, textTransform: "uppercase" }}>{activeTrait}</div>
                    {t.categories.map((cat, i) => {
                      const palette = ["#3B82F6","#10B981","#F59E0B","#EF4444",
                        "#8B5CF6","#EC4899","#06B6D4","#84CC16"];
                      return (
                        <div key={cat} style={{ display: "flex", alignItems: "center",
                          gap: 6, marginBottom: 3 }}>
                          <div style={{ width: 10, height: 10, borderRadius: 2,
                            background: palette[i % palette.length], flexShrink: 0 }} />
                          <span style={{ fontSize: 10, color: "#a0aec0" }}>{cat}</span>
                        </div>
                      );
                    })}
                  </div>
                );
                return (
                  <div>
                    <div style={{ fontSize: 10, color: "#64748b",
                      marginBottom: 4, textTransform: "uppercase" }}>{activeTrait}</div>
                    <div style={{ height: 8, borderRadius: 4, overflow: "hidden",
                      background: `linear-gradient(90deg, ${t.color_low}, ${t.color_high})` }} />
                    <div style={{ display: "flex", justifyContent: "space-between",
                      marginTop: 2, fontSize: 9, color: "#4b5563" }}>
                      <span>{t.min}</span><span>{t.max}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {graphLoading || !graphData
            ? <Spinner />
            : (
              <PedigreeCanvas
                graph={graphData}
                colorMap={colorMap}
                selected={selectedId}
                onSelect={handleSelect}
              />
            )}
        </div>

        {/* Detail panel */}
        {selectedDetail && (
          <IndividualPanel
            individual={selectedDetail}
            traits={traits}
            markers={markers}
            onSelectId={handleSelect}
            onClose={() => { setSelectedId(null); setDetail(null); }}
          />
        )}
      </div>

      {/* Hidden file input for browser fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".dat,.pmp,.json"
        multiple
        style={{ display: "none" }}
        onChange={handleFileInputChange}
      />
    </div>
  );
}
