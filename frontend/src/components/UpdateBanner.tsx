// components/UpdateBanner.tsx
// ===========================
// Dismissible "new version available" bar under the top bar. Same layout as
// App's error banner; blue while offering/installing, red if install fails.

import { RELEASES_URL, releasePageUrl, type Updater } from "../hooks/useUpdater";

const VISIBLE = new Set(["available", "downloading", "installing", "installFailed"]);

function formatMB(bytes: number) {
  return (bytes / 1_048_576).toFixed(1);
}

const linkStyle = {
  background: "transparent", padding: 0, fontSize: 12,
  textDecoration: "underline", cursor: "pointer",
} as const;

export default function UpdateBanner({ updater }: { updater: Updater }) {
  const { status, available, current, downloaded, total, error, dismissed } = updater;
  if (!updater.supported || dismissed || !available || !VISIBLE.has(status)) return null;

  const failed = status === "installFailed";
  const busy   = status === "downloading" || status === "installing";
  const fg     = failed ? "#fca5a5" : "#93c5fd";

  let text: string;
  if (status === "downloading") {
    text = total
      ? `Downloading Pedimap 2 v${available}… ${Math.floor((downloaded / total) * 100)}% (${formatMB(downloaded)} of ${formatMB(total)} MB)`
      : `Downloading Pedimap 2 v${available}… ${formatMB(downloaded)} MB`;
  } else if (status === "installing") {
    text = `Installing Pedimap 2 v${available}… Pedimap 2 will restart.`;
  } else if (failed) {
    text = `Could not install Pedimap 2 v${available}: ${error ?? "unknown error"}`;
  } else {
    text = `Pedimap 2 v${available} is available (you have v${current ?? "?"}).`;
  }

  return (
    <div role="status" style={{
      background: failed ? "#3b1d1d" : "#172338", color: fg,
      padding: "6px 14px", fontSize: 12,
      borderBottom: `1px solid ${failed ? "#5b2a2a" : "#2a4470"}`,
      display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
      <span style={{ flex: 1 }}>{failed ? "⚠️" : "⬆️"} {text}</span>

      {!busy && (
        <button onClick={() => updater.openExternal(releasePageUrl(available))}
          style={{ ...linkStyle, color: fg }}>
          What's new
        </button>
      )}
      {failed && (
        <button onClick={() => updater.openExternal(RELEASES_URL)}
          style={{ ...linkStyle, color: fg }}>
          Download from the Releases page
        </button>
      )}
      {status === "available" && (
        <button onClick={() => void updater.installUpdate()}
          style={{ background: "#1d3a6e", color: "#4f9cf9", padding: "3px 10px", fontSize: 11 }}>
          Install and restart
        </button>
      )}
      {!busy && (
        <button onClick={updater.dismiss}
          style={{ background: "transparent", color: fg, fontSize: 11 }}>
          {failed ? "Dismiss" : "Later"}
        </button>
      )}
    </div>
  );
}
