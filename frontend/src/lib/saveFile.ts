// lib/saveFile.ts
// ===============
// Save exported files. In the desktop app files are saved through the native
// save dialog and written by the Rust shell (a browser-style download does not
// save files from the webview), which only writes to the path the dialog
// returned. Elsewhere they are browser downloads. Both return false if the
// user cancelled the dialog.

import { invoke, isTauri } from "@tauri-apps/api/core";

function browserDownload(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveTextFile(defaultName: string, text: string, type = "text/plain"): Promise<boolean> {
  if (isTauri()) {
    const path = await invoke<string>("save_file_dialog", { defaultName });
    if (!path) return false;
    await invoke("write_file", { path, content: text });
    return true;
  }
  browserDownload(defaultName, new Blob([text], { type }));
  return true;
}

export async function saveBinaryFile(defaultName: string, bytes: Uint8Array, type: string): Promise<boolean> {
  if (isTauri()) {
    const path = await invoke<string>("save_file_dialog", { defaultName });
    if (!path) return false;
    // Raw body (no JSON encoding of the bytes); the path goes in a header,
    // percent-encoded because headers must be ASCII.
    await invoke("write_binary_file", bytes, { headers: { "x-path": encodeURIComponent(path) } });
    return true;
  }
  browserDownload(defaultName, new Blob([bytes as BlobPart], { type }));
  return true;
}
