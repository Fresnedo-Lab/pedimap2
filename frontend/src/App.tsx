// App.tsx
// ========
// Root component for Pedimap 2.
// Layout:  TopBar | [Sidebar | Canvas | DetailPanel]
//
// Fixes applied in this version
// ──────────────────────────────
// TS2322  PedigreeCanvas.Props.graph is typed as `GraphData` (non-nullable).
//         graphData state is `GraphData | null`.  The original ternary
//           graphLoading ? <Spinner/> : <PedigreeCanvas graph={graphData}/>
//         does NOT narrow the null — TypeScript still widens graphData back to
//         `GraphData | null` inside the else branch.  The fix is to add
//         `|| !graphData` to the condition so TypeScript narrows the type:
//           graphLoading || !graphData ? <Spinner/> : <PedigreeCanvas graph={graphData}/>
//                                                                              ^^^^^^^^^
//                                                            narrowed to GraphData here
//
// TS2322  onClick={loadGraph} and onClick={handleSubpop} — async functions
//         whose optional-string / void signatures don't match MouseEventHandler.
//         Wrapped in arrow functions: onClick={() => loadGraph()}  etc.

import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  useApi, useFetch, useBackendHealth,
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

// Readiness gate shown in the body until the backend answers /api/health.
// The top bar / toolbar is always rendered by App, so it stays usable even
// while this is on screen — the user is never trapped.
function BackendGate({
  status, lastError, onRetry,
}: {
  status: "starting" | "error";
  lastError: string | null;
  onRetry: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);

  if (status === "starting") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 14 }}>
        <div style={{ width: 36, height: 36, border: "3px solid #252e42",
          borderTopColor: "#4f9cf9", borderRadius: "50%",
          animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <span style={{ color: "#a0aec0", fontSize: 13 }}>
          Starting Pedimap backend…
        </span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 14, padding: 24 }}>
      <div style={{ fontSize: 30 }}>⚠️</div>
      <div style={{ color: "#e8ecf4", fontSize: 15, fontWeight: 600 }}>
        Cannot reach the Pedimap backend service.
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onRetry}
          style={{ background: "#1d3a6e", color: "#4f9cf9", padding: "6px 16px", fontSize: 13 }}>
          ↻ Retry
        </button>
        <button onClick={() => setShowDetail(s => !s)}
          style={{ background: "#252e42", color: "#a0aec0", padding: "6px 16px", fontSize: 13 }}>
          {showDetail ? "Hide details" : "Show details"}
        </button>
      </div>
      {showDetail && (
        <pre style={{ maxWidth: 520, maxHeight: 180, overflow: "auto",
          background: "#0b0e14", border: "1px solid #2e3a52", borderRadius: 6,
          padding: 10, color: "#94a3b8", fontSize: 11, whiteSpace: "pre-wrap",
          margin: 0 }}>
          {lastError ?? "No error detail available."}
        </pre>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const api = useApi();

  // ── Backend readiness gate (Issue 2) ──────────────────────────────────────
  const { status: backendStatus, lastError: backendError, retry: retryBackend } =
    useBackendHealth();
  const ready = backendStatus === "ready";

  // Surface failed requests in the UI instead of as unhandled rejections.
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Server data (deferred until the backend is ready) ─────────────────────
  const { data: pedigree, reload: reloadPedigree } =
    useFetch<PedigreeData>(() => api.getPedigree(), [], ready);

  const { data: indList, reload: reloadIndividuals } =
    useFetch<IndividualSummary[]>(() => api.listIndividuals(), [], ready);

  const [graphData,   setGraphData]   = useState<GraphData | null>(null);
  const [colorMap,    setColorMap]    = useState<Record<string, string>>({});
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
      setLoadError(null);
    } catch (e) {
      // Issue 3: surface the failure in the UI error banner rather than
      // letting the rejection go unhandled.
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setGraphLoading(false);
    }
  }, [api, activeTrait]);

  // Single refresh of every dataset-scoped endpoint. Any loader that swaps the
  // active dataset MUST call this instead of refetching an ad-hoc subset, so a
  // new loader cannot forget an endpoint (e.g. the sidebar's /api/individuals)
  // and leave a panel showing the previous dataset.
  const reloadAllData = useCallback(async () => {
    reloadPedigree();
    reloadIndividuals();
    await loadGraph();
  }, [reloadPedigree, reloadIndividuals, loadGraph]);

  // Issue 2 + 3: initialise once, only after the backend reports healthy.
  // loadGraph catches its own errors, so this fire-and-forget call can't reject.
  const didInit = useRef(false);
  useEffect(() => {
    if (ready && !didInit.current) {
      didInit.current = true;
      void loadGraph();
    }
  }, [ready, loadGraph]);

  // ── Selection ─────────────────────────────────────────────────────────────
  const [selectedId,     setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setDetail]     = useState<IndividualDetail | null>(null);

  const handleSelect = useCallback(async (id: string) => {
    setSelectedId(id);
    try { setDetail(await api.getIndividual(id)); }
    catch { /* silently ignore */ }
  }, [api]);

  // ── Trait colouring ───────────────────────────────────────────────────────
  const handleTraitChange = useCallback(async (name: string) => {
    setActiveTrait(name);
    try {
      // getColorMap returns the default (empty) map when name is "" — no request.
      const cm = await api.getColorMap(name);
      setColorMap(cm);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  // ── File open ─────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenFile = useCallback(async () => {
    if (isTauri()) {
      try {
        const path = await invoke<string>("open_file_dialog");
        if (!path) return;
        const content = await invoke<string>("read_file", { path });
        const fname   = path.split(/[\\/]/).pop() ?? "file.json";
        const blob    = new Blob([content], { type: "text/plain" });
        const file    = new File([blob], fname);
        await api.loadFile([file]);
        await reloadAllData();
        setLoadError(null);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    } else {
      fileInputRef.current?.click();
    }
  }, [api, reloadAllData]);

  const handleFileInputChange = useCallback(async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = e.target.files;
    if (!files?.length) return;
    try {
      await api.loadFile(files);
      await reloadAllData();
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
    e.target.value = "";
  }, [api, reloadAllData]);

  // ── Subpopulation ─────────────────────────────────────────────────────────
  const handleSubpop = useCallback(async () => {
    if (!selectedId) return;
    try {
      const g = await api.buildSubpop({
        focal_id: selectedId, ancestors: true, descendants: true, siblings: false,
      });
      setGraphData(g);
      const cm = await api.getColorMap(activeTrait);
      setColorMap(cm);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [api, selectedId, activeTrait]);

  const handleLoadExample = useCallback(async () => {
    try {
      await api.loadDemo("Example");
      await reloadAllData();
      setSelectedId(null);
      setDetail(null);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [api, reloadAllData]);

  const handleReset = useCallback(async () => {
    try {
      await api.reset();
      await reloadAllData();
      setSelectedId(null);
      setDetail(null);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [api, reloadAllData]);

  // ── Search filter ─────────────────────────────────────────────────────────
  // (indList is fetched near the top so its reload can join reloadAllData.)
  const [search, setSearch] = useState("");
  const filtered = (indList ?? []).filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    i.id.toLowerCase().includes(search.toLowerCase())
  );

  // ── Render ────────────────────────────────────────────────────────────────
  const traits  = pedigree?.traits  ?? [];
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

        <button onClick={handleLoadExample}
          style={{ background: "#252e42", color: "#a0aec0", padding: "5px 12px" }}>
          📄 Load Example Data
        </button>

        {traits.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
            <span style={{ color: "#64748b", fontSize: 11 }}>Colour by:</span>
            <select
              value={activeTrait}
              onChange={e => handleTraitChange(e.target.value)}
              style={{ width: 160 }}>
              <option value="">None</option>
              {traits.map(t => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>
        )}

        {selectedId && (
          <button onClick={() => handleSubpop()}
            style={{ background: "#1d3a6e", color: "#4f9cf9", padding: "5px 12px" }}>
            🔍 Subpop: {selectedId}
          </button>
        )}

        {selectedId && graphData && graphData.nodes.length < (indList?.length ?? 0) && (
          <button onClick={() => loadGraph()}
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

      {/* ── Error banner (Issue 3) ───────────────────────────────────────── */}
      {loadError && (
        <div style={{ background: "#3b1d1d", color: "#fca5a5",
          padding: "6px 14px", fontSize: 12, borderBottom: "1px solid #5b2a2a",
          display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ flex: 1 }}>⚠️ {loadError}</span>
          <button onClick={() => setLoadError(null)}
            style={{ background: "transparent", color: "#fca5a5", fontSize: 11 }}>
            Dismiss
          </button>
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>

        {/* Issue 2: gate the workspace on backend readiness. The top bar above
            stays mounted and enabled in every state, so the user can always
            Retry, open a file, or reset. */}
        {!ready ? (
          <BackendGate
            status={backendStatus === "error" ? "error" : "starting"}
            lastError={backendError}
            onRetry={retryBackend}
          />
        ) : (
        <>
        {/* Sidebar */}
        <div style={{ width: 220, flexShrink: 0, display: "flex",
          flexDirection: "column", background: "#161b27",
          borderRight: "1px solid #2e3a52", overflow: "hidden" }}>

          <div style={{ padding: "8px 10px", borderBottom: "1px solid #2e3a52" }}>
            <input
              placeholder="Search individuals…"
              value={search}
              onChange={e => setSearch(e.target.value)}
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
                  borderLeft: selectedId === ind.id
                    ? "3px solid #4f9cf9"
                    : "3px solid transparent",
                }}>
                <div style={{ fontSize: 12, color: "#e8ecf4",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {ind.name}
                </div>
                <div style={{ fontSize: 10, color: "#4b5563", marginTop: 1 }}>
                  {ind.cross_type} · Gen {ind.generation}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Canvas ── FIX: guard is `graphLoading || !graphData` so TypeScript  */}
        {/* narrows graphData to `GraphData` (not null) in the else branch,     */}
        {/* satisfying PedigreeCanvas's non-nullable `graph: GraphData` prop.   */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {graphLoading || !graphData
            ? <Spinner />
            : (
              <PedigreeCanvas
                graph={graphData}          // ← GraphData here, null excluded
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
        </>
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
