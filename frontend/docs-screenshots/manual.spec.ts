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
