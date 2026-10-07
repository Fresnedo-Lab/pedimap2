// Links never cross an individual or × they do not connect, checked in WebKit
// on the SVG file the app exports (Export image… → SVG), for every display
// setting. WebKit itself measures the exported drawing: the link paths from
// their path data, and each node's box (shape and label) with getBBox().

import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const backendPort = Number(process.env.E2E_BACKEND_PORT ?? 8765);
const backend = `http://127.0.0.1:${backendPort}`;

const SETTINGS = (["Classic Pedimap", "Modern"] as const).flatMap(style =>
  (["↓ Top to bottom", "→ Left to right"] as const).flatMap(orientation =>
    [true, false].map(crosses => ({ style, orientation, crosses }))));

// Runs in the page, on the exported SVG text.
function findCrossings(svgText: string) {
  type Pt = { x: number; y: number };
  type Box = { name: string; left: number; right: number; top: number; bottom: number };
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:0;top:0;visibility:hidden";
  host.innerHTML = svgText.replace(/^<\?xml[^>]*>/, "");
  document.body.appendChild(host);
  const svg = host.querySelector("svg")!;
  const toRoot = (el: SVGGraphicsElement) => svg.getCTM()!.inverse().multiply(el.getCTM()!);
  const map = (m: DOMMatrix, p: Pt): Pt => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
  const boxOf = (name: string, el: SVGGraphicsElement): Box => {
    const b = el.getBBox(), m = toRoot(el);
    const a = map(m, { x: b.x, y: b.y }), z = map(m, { x: b.x + b.width, y: b.y + b.height });
    return { name, left: Math.min(a.x, z.x), right: Math.max(a.x, z.x), top: Math.min(a.y, z.y), bottom: Math.max(a.y, z.y) };
  };
  const boxes = [
    ...[...svg.querySelectorAll<SVGGElement>("g.node")].map(g => boxOf(g.querySelector("text")?.textContent ?? "?", g)),
    ...[...svg.querySelectorAll<SVGGElement>("g.cross")].map(g => boxOf("×", g)),
  ];

  // Polyline of a path's absolute M/L/C data (curves sampled).
  const polyline = (d: string): Pt[] => {
    const tokens = d.match(/[MLC]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
    const pts: Pt[] = [];
    let cmd = "", i = 0;
    const num = () => Number(tokens[i++]);
    while (i < tokens.length) {
      if (/[MLC]/.test(tokens[i])) cmd = tokens[i++];
      if (cmd === "C") {
        const p0 = pts[pts.length - 1], c1 = { x: num(), y: num() }, c2 = { x: num(), y: num() }, p3 = { x: num(), y: num() };
        for (let k = 1; k <= 24; k++) {
          const t = k / 24, u = 1 - t;
          pts.push({ x: u*u*u*p0.x + 3*u*u*t*c1.x + 3*u*t*t*c2.x + t*t*t*p3.x,
                     y: u*u*u*p0.y + 3*u*u*t*c1.y + 3*u*t*t*c2.y + t*t*t*p3.y });
        }
      } else pts.push({ x: num(), y: num() });
    }
    return pts;
  };
  // Does segment p→q enter the inside of b (shrunk by half a pixel)?
  const hits = (p: Pt, q: Pt, b: Box) => {
    const l = b.left + 0.5, r = b.right - 0.5, t = b.top + 0.5, btm = b.bottom - 0.5;
    if (l >= r || t >= btm) return false;
    const dx = q.x - p.x, dy = q.y - p.y;
    let t0 = 0, t1 = 1;
    for (const [pp, qq] of [[-dx, p.x - l], [dx, r - p.x], [-dy, p.y - t], [dy, btm - p.y]]) {
      if (pp === 0) { if (qq < 0) return false; continue; }
      const k = qq / pp;
      if (pp < 0) { if (k > t1) return false; if (k > t0) t0 = k; } else { if (k < t0) return false; if (k < t1) t1 = k; }
    }
    return t0 < t1;
  };
  const touches = (p: Pt, b: Box) => p.x >= b.left - 1.5 && p.x <= b.right + 1.5 && p.y >= b.top - 1.5 && p.y <= b.bottom + 1.5;

  const paths = [...svg.querySelectorAll<SVGPathElement>("g.links path")];
  const crossings: string[] = [];
  for (const path of paths) {
    const m = toRoot(path);
    const pts = polyline(path.getAttribute("d") ?? "").map(p => map(m, p));
    const ends = boxes.filter(b => touches(pts[0], b) || touches(pts[pts.length - 1], b));
    for (const b of boxes) {
      if (ends.includes(b)) continue;
      for (let i = 1; i < pts.length; i++) {
        if (hits(pts[i - 1], pts[i], b)) {
          crossings.push(`${path.getAttribute("class")} from ${ends.map(e => e.name).join(" / ")} crosses ${b.name}`);
          break;
        }
      }
    }
  }
  host.remove();
  return { links: paths.length, individuals: svg.querySelectorAll("text.individual").length, crossings };
}

async function load(page: Page, dataset: string) {
  await page.goto("/");
  await page.getByText(/individuals/).first().waitFor();
  if (dataset === "Example") await page.getByRole("button", { name: /Load Example Data/ }).click();
  else if (dataset === "Demo Data") await page.getByRole("button", { name: /Demo Data/ }).click();
  else {
    // Uploaded straight to the backend, then shown by reloading the app.
    const file = path.resolve("../backend/tests/fixtures", dataset);
    const form = new FormData();
    form.append("dat_file", new Blob([fs.readFileSync(file)]), path.basename(file));
    const res = await fetch(`${backend}/api/load`, { method: "POST", body: form });
    expect(res.ok, `load ${dataset}`).toBe(true);
    await page.reload();
  }
  await page.getByText(/individuals/).first().waitFor();
}

async function exportSvg(page: Page): Promise<string> {
  await page.getByRole("button", { name: /Export image/ }).click();
  await page.locator('input[name="image-format"][value="svg"]').check();
  const save = page.getByRole("button", { name: "Save…" });
  const [download] = await Promise.all([page.waitForEvent("download"), save.click()]);
  return fs.readFileSync((await download.path())!, "utf-8");
}

test.beforeEach(async ({ page }) => {
  // The app calls the backend at 127.0.0.1:8765; follow it to another port.
  if (backendPort !== 8765) {
    await page.route("http://127.0.0.1:8765/**", async route =>
      route.fulfill({ response: await route.fetch({ url: route.request().url().replace(":8765", `:${backendPort}`) }) }));
  }
});

async function expectNoCrossings(page: Page, dataset: string) {
  await load(page, dataset);
  const failures: string[] = [];
  for (const s of SETTINGS) {
    await page.getByRole("button", { name: s.style, exact: true }).click();
    await page.getByRole("button", { name: s.orientation, exact: true }).click();
    await page.getByTitle("Settings").click();
    const crosses = page.getByLabel("Show cross symbols (×)");
    if ((await crosses.isChecked()) !== s.crosses) await crosses.click();
    await page.getByTitle("Settings").click();
    await page.getByText(/Laying out/).waitFor({ state: "detached" });
    await page.waitForTimeout(800);                         // layout and first frame

    const label = `${s.style}, ${s.orientation.slice(2)}, cross symbols ${s.crosses ? "on" : "off"}`;
    const svg = await exportSvg(page);
    const result = await page.evaluate(findCrossings, svg);
    // The export shows the whole loaded population (not, say, a stale one).
    const loaded = (await (await fetch(`${backend}/api/individuals`)).json()).length;
    expect(result.individuals, label).toBe(loaded);
    expect(result.links, label).toBeGreaterThan(0);
    failures.push(...result.crossings.map(c => `${label}: ${c}`));
  }
  expect(failures).toEqual([]);
}

for (const dataset of ["Example", "apple_public.dat", "Demo Data"]) {
  test(`${dataset}: exported links cross no other individual or ×, in all 8 settings`,
       ({ page }) => expectNoCrossings(page, dataset));
}

// The private pedigree is never committed; runs only where the file exists
// (E2E_PRIVATE_DAT, default backend/tests/fixtures/TransApple_Consolidated.dat).
const privateDat = path.resolve(process.env.E2E_PRIVATE_DAT ?? "../backend/tests/fixtures/TransApple_Consolidated.dat");
test("private pedigree: exported links cross no other individual or ×, in all 8 settings", async ({ page }) => {
  test.skip(!fs.existsSync(privateDat), "private pedigree not present");
  await expectNoCrossings(page, privateDat);
});
