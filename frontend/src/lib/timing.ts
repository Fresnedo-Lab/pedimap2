// lib/timing.ts
// =============
// Performance marks around the chart's layout and drawing, read by the WebKit
// performance test (e2e/performance.spec.ts) with performance.getEntriesByName
// ("pedimap:layout", "pedimap:draw"). Cheap, and harmless in the app.

const KEEP = 200;                    // measures kept per name

export function timingStart(name: string): void {
  if (typeof performance?.mark === "function") performance.mark(`pedimap:${name}-start`);
}

export function timingEnd(name: string): void {
  if (typeof performance?.measure !== "function") return;
  const label = `pedimap:${name}`;
  try {
    performance.measure(label, `${label}-start`);
  } catch {
    return;                          // no start mark (e.g. a frame drawn before it)
  }
  if (performance.getEntriesByName(label).length > KEEP) performance.clearMeasures(label);
}
