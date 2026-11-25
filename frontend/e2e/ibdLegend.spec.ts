// The on-screen legend of the IBD bars, in WebKit: the same founders, alleles
// and colors as the exported image's legend; collapsed, it stays collapsed
// after a reload; it never covers the coloring's legend.

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
  await page.evaluate(() => localStorage.clear());
  const file = path.resolve("../backend/tests/fixtures/flexqtl_binko/flexqtl_routeB_sim_small.ped.gz");
  const form = new FormData();
  form.append("dat_file", new Blob([zlib.gunzipSync(fs.readFileSync(file))]), "flexqtl_routeB_sim_small.ped");
  expect((await fetch(`${backend}/api/load`, { method: "POST", body: form })).ok).toBe(true);
  await page.reload();
  await page.getByText(/individuals/).first().waitFor();
  await page.getByLabel("IBD bars").selectOption({ index: 1 });            // linkage group 1
  await page.waitForTimeout(800);
}

async function exportSvg(page: Page): Promise<string> {
  await page.getByRole("button", { name: /Export image/ }).click();
  await page.locator('input[name="image-format"][value="svg"]').check();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save…" }).click()]);
  return fs.readFileSync((await download.path())!, "utf-8");
}

test("the on-screen legend shows the exported legend's founders, alleles and colors", async ({ page }) => {
  await loadFlexQtl(page);
  const legend = page.getByRole("group", { name: "Founder alleles" });
  await expect(legend).toBeVisible();
  const onScreen = await legend.evaluate(group => [...group.querySelectorAll("[data-founder]")].map(name => [
    name.getAttribute("data-founder"),
    [name.nextElementSibling!, name.nextElementSibling!.nextElementSibling!]
      .filter(c => c.getAttribute("data-allele")).map(c => [c.getAttribute("data-allele"), c.getAttribute("data-color")])]));
  const title = await legend.getByRole("button").textContent();

  const svg = await exportSvg(page);
  const exported = await page.evaluate(text => {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    return {
      title: doc.querySelector("g.founder-alleles text.legend-title")!.textContent,
      rows: [...doc.querySelectorAll("g.founder-alleles g.legend-row")].map(row => [row.getAttribute("data-founder"),
        [...row.querySelectorAll("rect[data-allele]")].map(r => [r.getAttribute("data-allele"), r.getAttribute("fill")])]),
    };
  }, svg);
  expect(title).toContain(exported.title);
  expect(onScreen).toEqual(exported.rows);
  expect(onScreen).toHaveLength(29);
});

test("collapsed, the legend stays collapsed after a reload", async ({ page }) => {
  await loadFlexQtl(page);
  const toggle = page.getByRole("group", { name: "Founder alleles" }).getByRole("button");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await page.getByText(/individuals/).first().waitFor();
  if (!(await page.getByLabel("IBD bars").inputValue())) await page.getByLabel("IBD bars").selectOption({ index: 1 });
  await expect(page.getByRole("group", { name: "Founder alleles" }).getByRole("button"))
    .toHaveAttribute("aria-expanded", "false");
});

test("with a coloring legend as well, the two never overlap", async ({ page }) => {
  await loadFlexQtl(page);
  await page.getByLabel("Color by").selectOption({ label: "Genotype code at marker…" });
  const coloring = page.getByRole("group", { name: /^Legend:/ });
  const founders = page.getByRole("group", { name: "Founder alleles" });
  await expect(coloring).toBeVisible();
  const a = (await coloring.boundingBox())!, b = (await founders.boundingBox())!;
  const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlap).toBe(false);
  expect(b.y + b.height).toBeLessThanOrEqual(a.y);                          // founder alleles above
});
