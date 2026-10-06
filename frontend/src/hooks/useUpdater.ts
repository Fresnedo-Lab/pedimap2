// hooks/useUpdater.ts
// ===================
// In-app update check (Tauri updater plugin). The app fetches
// releases/latest/download/latest.json (endpoint in tauri.conf.json); the
// release workflow publishes that file, signed with the updater key.
//
// • Checks once at startup, after the backend health gate reports ready, and
//   whenever the user clicks "Check for updates". Never blocks the UI.
// • The automatic check fails silently (console only): offline users and
//   GitHub hiccups must not produce error banners. A manual check reports.
// • Does nothing in the plain-browser build: the plugins are loaded with
//   dynamic import() behind isTauri(), so they never load outside Tauri.
//
// Only versions that contain this check can be told about later releases;
// users on 2.1.0 or older have to install 2.1.2 manually (2.1.1 was never
// released).

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

export const RELEASES_URL = "https://github.com/Fresnedo-Lab/pedimap2/releases";
export const releasePageUrl = (version: string) => `${RELEASES_URL}/tag/v${version}`;

const CHECK_TIMEOUT_MS = 15_000;

export type UpdateStatus =
  | "idle"            // nothing to show
  | "checking"
  | "upToDate"        // manual check only
  | "checkFailed"     // manual check only; automatic failures stay "idle"
  | "available"
  | "downloading"
  | "installing"      // download done; backend stopped; installer running
  | "installFailed";

export interface UpdaterState {
  status:     UpdateStatus;
  current:    string | null;   // running version, e.g. "2.1.2"
  available:  string | null;   // offered version, e.g. "2.2.0"
  downloaded: number;          // bytes
  total:      number | null;   // bytes, if the server sent Content-Length
  error:      string | null;
  dismissed:  boolean;         // "Later" hides the banner until the next check
}

export interface Updater extends UpdaterState {
  supported:      boolean;     // false in the browser build
  checkForUpdates: (manual: boolean) => Promise<void>;
  installUpdate:  () => Promise<void>;
  dismiss:        () => void;
  openExternal:   (url: string) => Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useUpdater(backendReady: boolean): Updater {
  const supported = isTauri();
  const [state, setState] = useState<UpdaterState>({
    status: "idle", current: null, available: null,
    downloaded: 0, total: null, error: null, dismissed: false,
  });
  const update = useRef<Update | null>(null);
  const busy   = useRef(false);

  // Running version, for the About panel. core:default grants app:allow-version.
  useEffect(() => {
    if (!supported) return;
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(v => setState(s => ({ ...s, current: v })))
      .catch(e => console.warn("[updater] could not read app version:", e));
  }, [supported]);

  const checkForUpdates = useCallback(async (manual: boolean) => {
    if (!supported || busy.current) return;
    busy.current = true;
    setState(s => ({ ...s, status: "checking", error: null }));
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const found = await check({ timeout: CHECK_TIMEOUT_MS });
      // Release the previous Update resource on the Rust side.
      await update.current?.close().catch(() => {});
      update.current = found;
      if (found) {
        setState(s => ({
          ...s, status: "available", current: found.currentVersion,
          available: found.version, dismissed: false,
        }));
      } else {
        setState(s => ({ ...s, status: manual ? "upToDate" : "idle" }));
      }
    } catch (e) {
      console.warn("[updater] update check failed:", e);
      setState(s => ({
        ...s,
        status: manual ? "checkFailed" : "idle",
        error:  manual ? message(e) : null,
      }));
    } finally {
      busy.current = false;
    }
  }, [supported]);

  // One automatic check per launch, once the backend is up (so it never
  // competes with startup for attention, and never runs if startup failed).
  const autoChecked = useRef(false);
  useEffect(() => {
    if (supported && backendReady && !autoChecked.current) {
      autoChecked.current = true;
      void checkForUpdates(false);
    }
  }, [supported, backendReady, checkForUpdates]);

  const installUpdate = useCallback(async () => {
    const found = update.current;
    if (!found || busy.current) return;
    busy.current = true;
    setState(s => ({ ...s, status: "downloading", downloaded: 0, total: null, error: null }));

    let installed = false;
    try {
      await found.download((ev: DownloadEvent) => {
        if (ev.event === "Started") {
          setState(s => ({ ...s, total: ev.data.contentLength ?? null }));
        } else if (ev.event === "Progress") {
          setState(s => ({ ...s, downloaded: s.downloaded + ev.data.chunkLength }));
        }
      });

      setState(s => ({ ...s, status: "installing" }));
      // The sidecar must be stopped before installing: Windows cannot replace
      // a running pedimap-backend.exe, and the relaunched app must not find
      // the old backend still holding port 8765. On Windows, install() quits
      // the app and hands over to the installer, so nothing below runs there.
      await invoke("stop_backend");
      try {
        await found.install();
        installed = true;
      } catch (e) {
        await invoke("start_backend").catch(err =>
          console.error("[updater] could not restart the backend:", err));
        throw e;
      }

      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      console.error("[updater] install failed:", e);
      setState(s => ({
        ...s, status: "installFailed",
        error: installed
          ? `The update was installed, but Pedimap 2 could not restart (${message(e)}). Please quit and reopen it.`
          : message(e),
      }));
    } finally {
      busy.current = false;
    }
  }, []);

  const dismiss = useCallback(() => setState(s => ({ ...s, dismissed: true })), []);

  // Opens in the system browser. shell:allow-open's default scope permits
  // https:// URLs.
  const openExternal = useCallback(async (url: string) => {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch (e) {
      console.warn("[updater] could not open", url, e);
    }
  }, []);

  return { ...state, supported, checkForUpdates, installUpdate, dismiss, openExternal };
}
