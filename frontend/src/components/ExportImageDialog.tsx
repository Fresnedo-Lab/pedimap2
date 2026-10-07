// components/ExportImageDialog.tsx
// =================================
// "Export image…": the whole displayed chart (full population or
// subpopulation, regardless of pan/zoom) as PNG, SVG or PDF.
//
// Opening the dialog starts loading jsPDF + svg2pdf.js (dynamic import, kept
// out of the startup bundle) and the chart font, so Save is quick.

import { useEffect, useState } from "react";
import { buildSvg, type SvgExportInput } from "../chart/svgExport";
import {
  loadChartFont, loadPdfLibraries, svgToPdf, svgToPng, PNG_SCALE,
  type ImageFormat, type PdfPage,
} from "../chart/imageExport";
import { saveBinaryFile, saveTextFile } from "../lib/saveFile";

interface Props {
  /** What to draw, from the live canvas; null if no chart is drawn. */
  buildInput: () => Omit<SvgExportInput, "fontBase64"> | null;
  /** File name without extension. */
  baseName:   string;
  /** e.g. "the whole population" or "the subpopulation around Gala". */
  scope:      string;
  onClose:    () => void;
}

const FORMATS: { value: ImageFormat; label: string; hint: string }[] = [
  { value: "png", label: "PNG", hint: `Bitmap at ${PNG_SCALE}× resolution` },
  { value: "svg", label: "SVG", hint: "Vector; editable in Inkscape or Illustrator" },
  { value: "pdf", label: "PDF", hint: "Vector; for printing and publication" },
];

const PAGES: { value: PdfPage; label: string }[] = [
  { value: "fit",    label: "Fitted to the chart" },
  { value: "letter", label: "US Letter, landscape" },
  { value: "a4",     label: "A4, landscape" },
];

const button = { background: "#252e42", color: "#a0aec0", padding: "5px 12px" };

export default function ExportImageDialog({ buildInput, baseName, scope, onClose }: Props) {
  const [format, setFormat] = useState<ImageFormat>("png");
  const [page,   setPage]   = useState<PdfPage>("fit");
  const [ready,  setReady]  = useState(false);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([loadPdfLibraries(), loadChartFont()])
      .then(() => { if (live) setReady(true); })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const input = buildInput();
      if (!input) throw new Error("There is no drawn chart to export.");
      const font = await loadChartFont();
      let saved: boolean;
      let reducedNotice: string | null = null;
      if (format === "svg") {
        const { svg } = buildSvg({ ...input, fontBase64: font });
        saved = await saveTextFile(`${baseName}.svg`, svg, "image/svg+xml");
      } else if (format === "png") {
        const { svg, width, height } = buildSvg({ ...input, fontBase64: font });
        const png = await svgToPng(svg, width, height);
        saved = await saveBinaryFile(`${baseName}.png`, png.bytes, "image/png");
        if (png.reduced) {
          reducedNotice =
            `The chart is too large for a ${PNG_SCALE}× PNG, so it was saved at ` +
            `${png.scale.toFixed(2)}× to stay within 16,000 pixels per side. ` +
            "For full detail, export SVG or PDF.";
        }
      } else {
        // No @font-face in the SVG for PDF: the font is embedded by jsPDF.
        const { svg, width, height } = buildSvg(input);
        const pdf = await svgToPdf(svg, width, height, page, font, await loadPdfLibraries());
        saved = await saveBinaryFile(`${baseName}.pdf`, pdf, "application/pdf");
      }
      if (saved && reducedNotice) setNotice(reducedNotice);
      else if (saved) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.45)",
        display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div role="dialog" aria-modal="true" aria-label="Export image"
        onClick={e => e.stopPropagation()}
        style={{ width: 340, padding: 16, background: "#161b27", border: "1px solid #2e3a52",
          borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,.5)", color: "#e8ecf4", fontSize: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Export image</div>
        <div style={{ color: "#64748b", marginBottom: 12 }}>
          The whole chart of {scope}, as displayed, regardless of zoom.
        </div>

        <fieldset style={{ border: "none", display: "grid", gap: 6, marginBottom: 12 }}>
          {FORMATS.map(f => (
            <label key={f.value} style={{ display: "flex", gap: 8, alignItems: "baseline", cursor: "pointer" }}>
              <input type="radio" name="image-format" value={f.value} checked={format === f.value}
                onChange={() => setFormat(f.value)} style={{ width: "auto" }} />
              <span style={{ width: 34, fontWeight: 600 }}>{f.label}</span>
              <span style={{ color: "#64748b", fontSize: 11 }}>{f.hint}</span>
            </label>
          ))}
        </fieldset>

        {format === "pdf" && (
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            Page:
            <select value={page} onChange={e => setPage(e.target.value as PdfPage)} style={{ flex: 1 }}>
              {PAGES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
        )}

        {notice && (
          <div role="status" style={{ background: "#16263f", color: "#a8c7f5", padding: 8,
            borderRadius: 6, marginBottom: 12, lineHeight: 1.45 }}>
            ℹ︎ {notice}
          </div>
        )}
        {error && (
          <div role="alert" style={{ background: "#3b1d1d", color: "#fca5a5", padding: 8,
            borderRadius: 6, marginBottom: 12 }}>
            ⚠️ {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={button}>{notice ? "Close" : "Cancel"}</button>
          {!notice && (
            <button onClick={() => void save()} disabled={!ready || saving}
              style={{ ...button, background: "#1d3a6e", color: "#4f9cf9",
                opacity: !ready || saving ? 0.6 : 1 }}>
              {saving ? "Saving…" : ready ? "Save…" : "Preparing…"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
