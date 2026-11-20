// Layout and redraw times of the chart in WebKit (docs/design/haplotype-display.md,
// §8), on the FlexQTL fixture and a synthetic 300-individual pedigree with 50 IBD
// positions. Read from the app's performance marks (src/lib/timing.ts). The
// limits are 5x the design's budgets, so that regressions fail without making
// CI flaky; the measured numbers are printed and attached to the test.
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
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

const DATASETS: Record<string, { file: () => Buffer; name: string; drawLimit: number }> = {
  "FlexQTL fixture": {
    name: "sim_small.ped", drawLimit: 5 * 16,
    file: () => zlib.gunzipSync(fs.readFileSync(path.resolve(
      "../backend/tests/fixtures/flexqtl_binko/flexqtl_routeB_sim_small.ped.gz"))),
  },
  "synthetic 300 x 50": {
    name: "synthetic_ibd.dat", drawLimit: 5 * 33,
    file: () => execFileSync(process.env.E2E_PYTHON ?? "python", ["-m", "tests.synthetic_ibd"],
                             { cwd: path.resolve("../backend"), maxBuffer: 64 << 20 }),
  },
};

const durations = (page: Page, name: string) =>
  page.evaluate(n => performance.getEntriesByName(n).map(e => e.duration), name);

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

for (const [label, dataset] of Object.entries(DATASETS)) for (const ibdBars of [false, true]) {
  test(`${label}${ibdBars ? " with IBD bars" : ""}: layout and redraw times`, async ({ page }) => {
    const form = new FormData();
    form.append("dat_file", new Blob([dataset.file()]), dataset.name);
    expect((await fetch(`${backend}/api/load`, { method: "POST", body: form })).ok).toBe(true);
    await page.goto("/");
    await page.getByText(/individuals/).first().waitFor();
    await page.waitForTimeout(1000);                          // layout, fit and first frames
    if (ibdBars) {
      // Turn the bars on, then reload: the setting is kept, so the layout and
      // first frame measured are the page's first, as for names only.
      await page.getByLabel("IBD bars").selectOption({ index: 1 });
      await page.waitForTimeout(500);
      await page.reload();
      await page.getByText(/individuals/).first().waitFor();
      await page.waitForTimeout(1500);
      await expect(page.getByLabel("IBD bars")).not.toHaveValue("");
    }

    const layout = await durations(page, "pedimap:layout");
    const firstFrame = (await durations(page, "pedimap:draw"))[0];
    expect(layout.length).toBeGreaterThan(0);

    // Pan/zoom frames: zoom in and out over the chart.
    await page.evaluate(() => performance.clearMeasures("pedimap:draw"));
    const canvas = page.locator("canvas").first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 30; i++) {
      await page.mouse.wheel(0, i % 2 ? 120 : -120);
      await page.waitForTimeout(30);
    }
    const draws = await durations(page, "pedimap:draw");
    expect(draws.length).toBeGreaterThan(10);

    const result = {
      dataset: label, ibd_bars: ibdBars, layout_ms: Math.round(layout[0]),
      first_frame_ms: Math.round(firstFrame),
      redraw_median_ms: +median(draws).toFixed(1), redraw_max_ms: +Math.max(...draws).toFixed(1),
      frames: draws.length,
    };
    console.log(JSON.stringify(result));
    test.info().annotations.push({ type: "timing", description: JSON.stringify(result) });
    expect(median(draws)).toBeLessThan(dataset.drawLimit);
  });
}
