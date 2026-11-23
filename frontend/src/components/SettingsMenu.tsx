// components/SettingsMenu.tsx
// ============================
// ⚙ toolbar popover: cross symbols and the IBD bars (per view), and the
// drawing limit (app-wide).

import { useEffect, useRef, useState } from "react";
import { BAR_WIDTH, DEFAULT_HAPLOTYPE_SETTINGS, formatThreshold } from "../lib/haplotype";
import type { HaplotypeViewSettings } from "../App";

interface Props {
  showCrossSymbols: boolean;
  crossSymbolSize:  number;
  drawingLimit:     number;
  onShowCrossSymbols: (show: boolean) => void;
  onCrossSymbolSize:  (size: number) => void;
  onDrawingLimit:     (limit: number) => void;
  /** The IBD bars' settings, when the loaded file has IBD data. */
  ibd?: (HaplotypeViewSettings & { onChange: (change: Partial<HaplotypeViewSettings>) => void }) | null;
}

export const CROSS_SYMBOL_SIZE = { min: 4, max: 40 };

const row = { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#e8ecf4" };
// 6.7:1 on the popover's background (WCAG AA for small text).
const hint = { fontSize: 11, color: "#94a3b8", lineHeight: 1.45 };
const stepButton = { width: 24, padding: "2px 0", flexShrink: 0, background: "#252e42", color: "#e8ecf4" };

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

  // The bar width: values in range apply as typed (so "38" is not stopped at
  // "3"); leaving the field shows the width in effect again.
  const [widthText, setWidthText] = useState(String(p.ibd?.barWidth ?? ""));
  useEffect(() => setWidthText(String(p.ibd?.barWidth ?? "")), [p.ibd?.barWidth]);
  const setWidth = (text: string) => {
    setWidthText(text);
    const n = Number(text);
    if (p.ibd && Number.isInteger(n) && n >= BAR_WIDTH.min && n <= BAR_WIDTH.max) p.ibd.onChange({ barWidth: n });
  };
  const step = (delta: number) => {
    if (!p.ibd) return;
    const n = Math.min(BAR_WIDTH.max, Math.max(BAR_WIDTH.min, p.ibd.barWidth + delta));
    if (n !== p.ibd.barWidth) p.ibd.onChange({ barWidth: n });
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
              style={{ width: 64, flexShrink: 0 }} />
          </label>
          {p.ibd && (<>
            <div style={{ borderTop: "1px solid #2e3a52" }} />
            <div role="heading" aria-level={3} style={{ ...row, fontWeight: 600 }}>IBD bars</div>
            <div style={row}>
              <label htmlFor="ibd-bar-width" style={{ flex: 1 }}>Bar width (px)</label>
              <button type="button" aria-label="Narrower bars" onClick={() => step(-1)}
                disabled={p.ibd.barWidth <= BAR_WIDTH.min} style={stepButton}>−</button>
              <input id="ibd-bar-width" type="number" min={BAR_WIDTH.min} max={BAR_WIDTH.max} step={1}
                value={widthText} onChange={e => setWidth(e.target.value)}
                onBlur={() => setWidthText(String(p.ibd!.barWidth))}
                style={{ width: 52, flexShrink: 0 }} />
              <button type="button" aria-label="Wider bars" onClick={() => step(1)}
                disabled={p.ibd.barWidth >= BAR_WIDTH.max} style={stepButton}>+</button>
            </div>
            <div style={hint} data-testid="merge-threshold">
              Probabilities below {formatThreshold({ ...DEFAULT_HAPLOTYPE_SETTINGS, barWidth: p.ibd.barWidth })} of
              a homologue are drawn as one gray remainder.
            </div>
            <label style={row}>
              <span style={{ flex: 1 }}>Palette</span>
              <select value={p.ibd.colorScheme} aria-label="Palette"
                onChange={e => p.ibd!.onChange({ colorScheme: e.target.value as HaplotypeViewSettings["colorScheme"] })}
                style={{ flexShrink: 0 }}>
                <option value="founder">By founder</option>
                <option value="allele">By founder allele</option>
              </select>
            </label>
            <div style={hint}>With many founders, 'By founder allele' separates colors better.</div>
          </>)}
          <div style={{ borderTop: "1px solid #2e3a52" }} />
          <label style={row}>
            <span style={{ flex: 1 }}>Drawing limit (individuals)</span>
            <input type="number" min={1} value={limitText} aria-label="Drawing limit"
              onChange={e => setLimitText(e.target.value)}
              onBlur={commitLimit}
              onKeyDown={e => { if (e.key === "Enter") commitLimit(); }}
              style={{ width: 80, flexShrink: 0 }} />
          </label>
          <div style={hint}>
            Larger populations are listed instead of drawn; build a subpopulation to draw part of one.
          </div>
        </div>
      )}
    </div>
  );
}
