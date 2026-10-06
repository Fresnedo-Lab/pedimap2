// components/AboutMenu.tsx
// ========================
// "ⓘ About" button at the right of the top bar: shows the running version
// and a manual "Check for updates". Desktop (Tauri) build only.

import { useEffect, useRef, useState } from "react";
import { RELEASES_URL, type Updater } from "../hooks/useUpdater";

export default function AboutMenu({ updater }: { updater: Updater }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Close when clicking anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!updater.supported) return null;

  const { status, current, available, error } = updater;
  let line: string | null = null;
  switch (status) {
    case "checking":      line = "Checking for updates…"; break;
    case "upToDate":      line = `You're up to date (v${current ?? "?"}).`; break;
    case "checkFailed":   line = `Could not check for updates: ${error ?? "unknown error"}`; break;
    case "available":
    case "downloading":
    case "installing":
    case "installFailed": line = `Pedimap 2 v${available} is available.`; break;
  }

  return (
    <div ref={root} style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} title="About Pedimap 2"
        style={{ background: "#252e42", color: "#a0aec0", padding: "5px 12px" }}>
        ⓘ About
      </button>

      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)",
          zIndex: 20, width: 260, padding: 12,
          background: "#161b27", border: "1px solid #2e3a52", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          display: "flex", flexDirection: "column", gap: 8, userSelect: "text" }}>
          <div style={{ color: "#e8ecf4", fontWeight: 700, fontSize: 13 }}>
            🌿 Pedimap 2
          </div>
          <div style={{ color: "#a0aec0", fontSize: 12 }}>
            Version {current ? `v${current}` : "…"}
          </div>

          <button
            // A check that finds an update also re-shows a banner hidden by "Later".
            onClick={() => void updater.checkForUpdates(true)}
            disabled={status === "checking" || status === "downloading" || status === "installing"}
            style={{ background: "#1d3a6e", color: "#4f9cf9", padding: "5px 12px", fontSize: 12 }}>
            Check for updates
          </button>

          {line && (
            <div style={{ fontSize: 11,
              color: status === "checkFailed" ? "#fca5a5" : "#a0aec0" }}>
              {line}
            </div>
          )}

          <button onClick={() => updater.openExternal(RELEASES_URL)}
            style={{ background: "transparent", color: "#4f9cf9", padding: 0,
              fontSize: 11, textDecoration: "underline", textAlign: "left" }}>
            All releases and release notes
          </button>
        </div>
      )}
    </div>
  );
}
