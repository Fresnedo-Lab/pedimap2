// components/SettingsMenu.tsx
// ============================
// ⚙ toolbar popover: cross symbols (per view) and the drawing limit (app-wide).

import { useEffect, useRef, useState } from "react";

interface Props {
  showCrossSymbols: boolean;
  crossSymbolSize:  number;
  drawingLimit:     number;
  onShowCrossSymbols: (show: boolean) => void;
  onCrossSymbolSize:  (size: number) => void;
  onDrawingLimit:     (limit: number) => void;
}

export const CROSS_SYMBOL_SIZE = { min: 4, max: 40 };

const row = { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#e8ecf4" };

export default function SettingsMenu(p: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Draft text for the limit, applied on blur/Enter so typing "2000" does not
  // pass through 2, 20 and 200 (each would hide or redraw the chart).
  const [limitText, setLimitText] = useState(String(p.drawingLimit));
  useEffect(() => setLimitText(String(p.drawingLimit)), [p.drawingLimit]);
  const commitLimit = () => {
    const n = Math.floor(Number(limitText));
    if (Number.isFinite(n) && n >= 1) p.onDrawingLimit(n);
    else setLimitText(String(p.drawingLimit));
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={root} style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} title="Settings"
        style={{ background: "#252e42", color: "#a0aec0", padding: "5px 10px" }}>
        ⚙
      </button>
      {open && (
        <div role="dialog" aria-label="Settings"
          style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50,
            width: 280, padding: 12, display: "grid", gap: 10, background: "#161b27",
            border: "1px solid #2e3a52", borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,.5)" }}>
          <label style={{ ...row, cursor: "pointer" }}>
            <input type="checkbox" checked={p.showCrossSymbols}
              onChange={e => p.onShowCrossSymbols(e.target.checked)} style={{ width: "auto" }} />
            Show cross symbols (×)
          </label>
          <label style={{ ...row, opacity: p.showCrossSymbols ? 1 : 0.5 }}>
            <span style={{ flex: 1 }}>Cross symbol size (px)</span>
            <input type="number" min={CROSS_SYMBOL_SIZE.min} max={CROSS_SYMBOL_SIZE.max}
              value={p.crossSymbolSize} disabled={!p.showCrossSymbols}
              onChange={e => {
                const n = Number(e.target.value);
                if (n >= CROSS_SYMBOL_SIZE.min && n <= CROSS_SYMBOL_SIZE.max) p.onCrossSymbolSize(n);
              }}
              style={{ width: 64 }} />
          </label>
          <div style={{ borderTop: "1px solid #2e3a52" }} />
          <label style={row}>
            <span style={{ flex: 1 }}>Drawing limit (individuals)</span>
            <input type="number" min={1} value={limitText} aria-label="Drawing limit"
              onChange={e => setLimitText(e.target.value)}
              onBlur={commitLimit}
              onKeyDown={e => { if (e.key === "Enter") commitLimit(); }}
              style={{ width: 80 }} />
          </label>
          <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.45 }}>
            Larger populations are listed instead of drawn; build a subpopulation to draw part of one.
          </div>
        </div>
      )}
    </div>
  );
}
