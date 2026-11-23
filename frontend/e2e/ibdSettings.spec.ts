// ⚙ "IBD bars", in WebKit: the bar width and palette change the chart on
// screen and the exported image alike, the export's legend title follows the
// merge threshold, and both settings survive a reload of the app.

import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const backendPort = Number(process.env.E2E_BACKEND_PORT ?? 8765);
const backend = `http://127.0.0.1:${backendPort}`;

test.beforeEach(async ({ page }) => {
  if (backendPort !== 8765) {
    await page.route("http://127.0.0.1:8765/**", async route =>
      route.fulfill({ response: await route.fetch({ url: route.request().url().replace(":8765", `:${backendPort}`) }) }));
  }
});

async function loadFlexQtl(page: Page) {
  await page.goto("/");
  await page.getByText(/individuals/).first().waitFor();
  const file = path.resolve("../backend/tests/fixtures/flexqtl_binko/flexqtl_routeB_sim_small.ped.gz");
  const form = new FormData();
  form.append("dat_file", new Blob([zlib.gunzipSync(fs.readFileSync(file))]), "flexqtl_routeB_sim_small.ped");
  expect((await fetch(`${backend}/api/load`, { method: "POST", body: form })).ok).toBe(true);
  await page.reload();
  await page.getByText(/individuals/).first().waitFor();
}

async function exportSvg(page: Page): Promise<string> {
  await page.getByRole("button", { name: /Export image/ }).click();
  await page.locator('input[name="image-format"][value="svg"]').check();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save…" }).click()]);
  return fs.readFileSync((await download.path())!, "utf-8");
}

/** What an exported SVG shows of the bars: their widths, the legend title and
 *  each founder allele's swatch color. */
const readExport = (svg: string) => ({
  widths: [...new Set([...svg.matchAll(/class="bar" [^>]*?[^-]width="([\d.]+)"/g)].map(m => Number(m[1])))],
  title: /class="legend-title"[^>]*>([^<]*)</.exec(svg.slice(svg.indexOf("founder-alleles")))?.[1],
  swatches: Object.fromEntries([...svg.matchAll(/class="legend-swatch"[^>]*fill="(#[0-9A-Fa-f]{6})"[^>]*data-allele="(\d+)"/g)]
    .map(m => [m[2], m[1]])),
});

const chartPixels = (page: Page) =>
  page.evaluate(() => document.querySelector<HTMLCanvasElement>("canvas")!.toDataURL());

test("bar width and palette: screen, export and the next session", async ({ page }) => {
  await loadFlexQtl(page);
  await page.getByLabel("IBD bars").selectOption({ index: 1 });                // linkage group 1
  await page.waitForTimeout(800);
  const before = readExport(await exportSvg(page));
  expect(before.widths).toEqual([20]);                                        // the default
  expect(before.title).toBe("Founder alleles, linkage group 1 (below 0.05 merged)");
  const screenBefore = await chartPixels(page);

  await page.getByTitle("Settings").click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByTestId("merge-threshold")).toContainText("below 0.05 of");
  await dialog.getByLabel("Bar width (px)").fill("14");
  await expect(dialog.getByTestId("merge-threshold")).toContainText("below 0.07 of");
  await dialog.getByLabel("Palette").selectOption("allele");
  await page.getByTitle("Settings").click();
  await page.waitForTimeout(800);
  expect(await chartPixels(page), "the chart on screen was drawn again").not.toBe(screenBefore);

  const after = readExport(await exportSvg(page));
  expect(after.widths).toEqual([14]);
  expect(after.title).toBe("Founder alleles, linkage group 1 (below 0.07 merged)");
  expect(Object.keys(after.swatches)).toHaveLength(58);
  expect(after.swatches).not.toEqual(before.swatches);                         // the by-allele palette

  // The app started again: the same settings, on screen and in the export.
  await page.reload();
  await page.getByText(/individuals/).first().waitFor();
  if (!(await page.getByLabel("IBD bars").inputValue())) await page.getByLabel("IBD bars").selectOption({ index: 1 });
  await page.waitForTimeout(800);
  await page.getByTitle("Settings").click();
  await expect(page.getByLabel("Bar width (px)")).toHaveValue("14");
  await expect(page.getByLabel("Palette")).toHaveValue("allele");
  await page.getByTitle("Settings").click();
  const again = readExport(await exportSvg(page));
  expect(again).toEqual(after);
});
