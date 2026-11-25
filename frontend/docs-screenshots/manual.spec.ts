// The user manual's screenshots (docs/images/), from the app as it is built:
// `npm run docs:screenshots`. Each test sets up one view of the app and saves
// one PNG at 2× (deviceScaleFactor in playwright.docs.config.ts). Settings
// start empty, so the defaults are what the manual shows.
//
// Only Example.dat (Load Example Data), apple_public.dat and the FlexQTL
// fixture are used; never private data.

import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { BOX, DEFAULT_HAPLOTYPE_SETTINGS } from "../src/lib/haplotype";
import { THEMES } from "../src/chart/style";

const backendPort = Number(process.env.E2E_BACKEND_PORT ?? 8765);
const backend = `http://127.0.0.1:${backendPort}`;
const IMAGES = path.resolve("../docs/images");
fs.mkdirSync(IMAGES, { recursive: true });
const out = (name: string) => path.join(IMAGES, name);

/** Mark a PNG as 192 dpi (2× of 96), so the PDF manual prints it at the size
 *  it has on screen rather than twice that: a pHYs chunk after IHDR. */
function markDpi(file: string, dpi = 192) {
  const png = fs.readFileSync(file);
  const chunks: Buffer[] = [png.subarray(0, 8)];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at), end = at + 12 + length;
    const type = png.toString("latin1", at + 4, at + 8);
    if (type !== "pHYs") chunks.push(png.subarray(at, end));
    if (type === "IHDR") {
      const data = Buffer.alloc(9);
      const perMeter = Math.round(dpi / 0.0254);
      data.writeUInt32BE(perMeter, 0); data.writeUInt32BE(perMeter, 4); data.writeUInt8(1, 8);
      const body = Buffer.concat([Buffer.from("pHYs", "latin1"), data]);
      const head = Buffer.alloc(4); head.writeUInt32BE(9);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
      chunks.push(head, body, crc);
    }
    at = end;
  }
  fs.writeFileSync(file, Buffer.concat(chunks));
}

test.afterAll(() => {
  for (const f of fs.readdirSync(IMAGES).filter(f => f.endsWith(".png"))) markDpi(path.join(IMAGES, f));
});

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  // The chart's read-only probe (PedigreeCanvas.tsx) tells where a box is.
  await page.addInitScript(() => { (window as Window & { __PEDIMAP_E2E__?: boolean }).__PEDIMAP_E2E__ = true; });
  if (backendPort !== 8765) {
    await page.route("http://127.0.0.1:8765/**", async route =>
      route.fulfill({ response: await route.fetch({ url: route.request().url().replace(":8765", `:${backendPort}`) }) }));
  }
});

type Box = { left: number; top: number; width: number; height: number };
const boxOf = (page: Page, id: string) => page.evaluate(i =>
  (window as Window & { __pedimapChart?: { boxOf(id: string): Box | null } }).__pedimapChart!.boxOf(i), id);

/** The bundled Example.dat, as a new user opens it. */
async function loadExample(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByText(/individuals/).first().waitFor();
  await page.getByRole("button", { name: /Load Example Data/ }).click();
  await settle(page);
}

/** A fixture file from backend/tests/fixtures, loaded as Open File would. */
export async function loadFixture(page: Page, file: string) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  const full = path.resolve("../backend/tests/fixtures", file);
  const gz = full.endsWith(".gz");
  const bytes = gz ? zlib.gunzipSync(fs.readFileSync(full)) : fs.readFileSync(full);
  const form = new FormData();
  form.append("dat_file", new Blob([bytes]), path.basename(full, gz ? ".gz" : undefined));
  expect((await fetch(`${backend}/api/load`, { method: "POST", body: form })).ok).toBe(true);
  await page.reload();
  await settle(page);
}

/** Layout, fit to window and the first frames. */
async function settle(page: Page) {
  await page.getByText(/individuals/).first().waitFor();
  await page.waitForTimeout(1200);
}

async function clickIndividual(page: Page, id: string) {
  const b = (await boxOf(page, id))!;
  await page.mouse.click(b.left + b.width / 2, b.top + 8);       // on the name, above the bars
  await page.getByRole("complementary", { name: "Details" }).waitFor();
}

test("window-overview.png: Example.dat, just opened", async ({ page }) => {
  await loadExample(page);
  await page.screenshot({ path: out("window-overview.png") });
});

test("details-panel.png: 81015-045 selected", async ({ page }) => {
  await loadExample(page);
  await clickIndividual(page, "81015-045");
  await page.getByRole("complementary", { name: "Details" }).screenshot({ path: out("details-panel.png") });
});

test("color-by-trait.png: Example colored by Length, with its legend", async ({ page }) => {
  await loadExample(page);
  await page.getByLabel("Color by").selectOption("Length");
  await settle(page);
  await page.screenshot({ path: out("color-by-trait.png") });
});

test("ibd-bars-example.png: linkage group A, the mouse on 81015-045 at 0 cM", async ({ page }) => {
  await loadExample(page);
  await page.getByLabel("IBD bars").selectOption("A");
  await settle(page);
  const b = (await boxOf(page, "81015-045"))!;
  // In the box (lib/haplotype.ts, haplotypeBox, default settings): the first
  // homologue's bar starts BOX.gap/2 + barWidth left of the middle, below the
  // name row. Point at its first band (0 cM), in founder allele 1's segment
  // (the left 22 % of the bar). Box units times the chart's zoom are pixels.
  const zoom = await page.evaluate(() =>
    (window as Window & { __pedimapChart?: { getScale(): number } }).__pedimapChart!.getScale());
  const { barWidth } = DEFAULT_HAPLOTYPE_SETTINGS;
  const barsTop = BOX.padding + THEMES.modern.fontSize + BOX.nameGap;
  const x = b.left + (b.width / zoom / 2 - BOX.gap / 2 - barWidth + 0.11 * barWidth) * zoom;
  const y = b.top + (barsTop + 6) * zoom;
  await page.mouse.move(x, y);
  await page.waitForTimeout(400);
  await expect(page.getByText(/0\.22/)).toBeVisible();
  const pad = 140;
  await page.screenshot({ path: out("ibd-bars-example.png"),
    clip: { x: Math.max(0, b.left - pad), y: Math.max(0, b.top - pad), width: b.width + 2 * pad + 220, height: b.height + 2 * pad } });
});

test("details-ibd.png: the IBD section of 81015-045, group A at 0 cM", async ({ page }) => {
  await loadExample(page);
  await clickIndividual(page, "81015-045");
  const panel = page.getByRole("complementary", { name: "Details" });
  const ibd = panel.getByRole("region", { name: "IBD" });
  await ibd.scrollIntoViewIfNeeded();
  await ibd.getByLabel("IBD linkage group").selectOption("A");
  await ibd.getByLabel("IBD position").selectOption("0");
  await expect(ibd.getByText(/0\.78/)).toBeVisible();
  await ibd.screenshot({ path: out("details-ibd.png") });
});

test("export-dialog.png: Export image", async ({ page }) => {
  await loadExample(page);
  await page.getByRole("button", { name: /Export image/ }).click();
  await page.getByRole("dialog", { name: "Export image" }).screenshot({ path: out("export-dialog.png") });
});

// ── Chapter 5: the window ─────────────────────────────────────────────────────

const FLEXQTL = "flexqtl_binko/flexqtl_routeB_sim_small.ped.gz";
const chartArea = async (page: Page) => (await page.getByTestId("pedigree-canvas").boundingBox())!;

/** The part of the chart around the boxes of `ids`, with a margin, within the
 *  chart's area. */
async function around(page: Page, ids: string[], pad = 40) {
  const boxes = (await Promise.all(ids.map(id => boxOf(page, id)))).filter((b): b is Box => !!b);
  const area = await chartArea(page);
  const left = Math.max(area.x, Math.min(...boxes.map(b => b.left)) - pad);
  const top = Math.max(area.y, Math.min(...boxes.map(b => b.top)) - pad);
  const right = Math.min(area.x + area.width, Math.max(...boxes.map(b => b.left + b.width)) + pad);
  const bottom = Math.min(area.y + area.height, Math.max(...boxes.map(b => b.top + b.height)) + pad);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Every individual of the loaded pedigree. */
const allIds = async () =>
  ((await (await fetch(`${backend}/api/individuals`)).json()) as { id: string }[]).map(i => i.id);

/** Zoom in with the mouse wheel around an individual, then rest the mouse on
 *  an empty corner of the chart, which closes any tooltip. */
async function zoomAt(page: Page, id: string, steps: number) {
  const b = (await boxOf(page, id))!;
  await page.mouse.move(b.left + b.width / 2, b.top + b.height / 2);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(120); }
  await restMouse(page);
}
async function restMouse(page: Page) {
  const area = await chartArea(page);
  await page.mouse.move(area.x + area.width - 4, area.y + 4);
  await page.waitForTimeout(600);
}

test("toolbar.png: the toolbar, with the example open", async ({ page }) => {
  await loadExample(page);
  await page.getByRole("toolbar", { name: "Main toolbar" }).screenshot({ path: out("toolbar.png") });
});

test("settings.png: Settings with the IBD bars section (FlexQTL fixture)", async ({ page }) => {
  await loadFixture(page, FLEXQTL);
  await page.getByLabel("IBD bars").selectOption({ index: 1 });
  await settle(page);
  await page.getByTitle("Settings").click();
  await page.getByRole("dialog", { name: "Settings" }).screenshot({ path: out("settings.png") });
});

test("marker-data.png: the Marker data summary (FlexQTL fixture)", async ({ page }) => {
  await loadFixture(page, FLEXQTL);
  await page.getByTitle("Marker data of this file").click();
  await page.getByRole("dialog", { name: "Marker data" }).screenshot({ path: out("marker-data.png") });
});

// ── Chapter 6: visualization ──────────────────────────────────────────────────

test("classic-style.png: the example in Classic Pedimap, left to right", async ({ page }) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Classic Pedimap", exact: true }).click();
  await page.getByRole("button", { name: "→ Left to right", exact: true }).click();
  await settle(page);
  await page.screenshot({ path: out("classic-style.png"), clip: await around(page, await allIds()) });
});

test("trait-discrete.png: the example colored by Color, with its legend", async ({ page }) => {
  await loadExample(page);
  await page.getByLabel("Color by").selectOption("Color");
  await settle(page);
  await page.screenshot({ path: out("trait-discrete.png"), clip: await chartArea(page) });
});

test("marker-coloring.png: FlexQTL fixture, genotype code at M2_007", async ({ page }) => {
  await loadFixture(page, FLEXQTL);
  await page.getByLabel("Color by").selectOption({ label: "Genotype code at marker…" });
  await page.getByLabel("Marker").selectOption("M2_007");
  await settle(page);
  await expect(page.getByRole("group", { name: /^Legend:/ })).toBeVisible();
  // Founders (codes 5 and 0) and the first generation (one 11), large enough
  // to see, with the legend in the chart's corner.
  await zoomAt(page, "G1_003", 14);
  await page.screenshot({ path: out("marker-coloring.png"), clip: await chartArea(page) });
});

test("flexqtl-by-founder.png, flexqtl-by-allele.png: the same part of the chart in both palettes", async ({ page }) => {
  await loadFixture(page, FLEXQTL);
  await page.getByLabel("IBD bars").selectOption({ index: 1 });            // linkage group 1
  await settle(page);
  // Zoom in on generations 2 and 3, around G3_010, and keep ten boxes of each.
  await zoomAt(page, "G3_010", 9);
  const ids = ["G2", "G3"].flatMap(g => Array.from({ length: 10 }, (_, i) => `${g}_${String(i + 6).padStart(3, "0")}`));
  const area = await around(page, ids, 24);
  await page.screenshot({ path: out("flexqtl-by-founder.png"), clip: area });

  await page.getByTitle("Settings").click();
  await page.getByLabel("Palette").selectOption("allele");
  await page.getByTitle("Settings").click();                 // close it again
  await restMouse(page);
  await page.screenshot({ path: out("flexqtl-by-allele.png"), clip: area });
});

// ── Chapters 7 and 8: subpopulations, export, large pedigrees ────────────────

const APPLE = "apple_public.dat";

test("subpopulation.png: Gala's ancestors and descendants, and the export panel (apple_public.dat)", async ({ page }) => {
  await loadFixture(page, APPLE);
  await clickIndividual(page, "Gala");
  await page.getByRole("button", { name: /Subpop: Gala/ }).click();
  await settle(page);
  await page.getByRole("button", { name: /Export subpopulation/ }).click();
  await page.getByRole("dialog", { name: "Export subpopulation" }).waitFor();
  await page.screenshot({ path: out("subpopulation.png") });
});

test("drawing-limit.png: apple_public.dat listed, with the drawing limit set to 10", async ({ page }) => {
  await loadFixture(page, APPLE);
  await page.getByTitle("Settings").click();
  const limit = page.getByLabel("Drawing limit");
  await limit.fill("10");
  await limit.press("Enter");
  await page.getByTitle("Settings").click();
  await expect(page.getByText(/more than the drawing limit of 10/)).toBeVisible();
  await page.screenshot({ path: out("drawing-limit.png") });
});
