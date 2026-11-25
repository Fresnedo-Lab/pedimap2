// Save as JSON, in WebKit: the FlexQTL test file saved with the button and
// opened again gives the same individuals, parent labels and IBD data.

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

async function upload(page: Page, bytes: Buffer, name: string) {
  const form = new FormData();
  form.append("dat_file", new Blob([bytes]), name);
  const reply = await fetch(`${backend}/api/load`, { method: "POST", body: form });
  expect(reply.ok, `load ${name}`).toBe(true);
  await page.reload();
  await page.getByText(/individuals/).first().waitFor();
  return reply.json();
}

/** What the app knows of the loaded pedigree, from the API it reads. */
async function snapshot() {
  const get = async (p: string) => (await fetch(`${backend}${p}`)).json();
  const pedigree = await get("/api/pedigree");
  return {
    population: pedigree.population,
    labels: pedigree.parent_labels,
    individuals: await get("/api/individuals"),
    graph: await get("/api/graph"),
    group1: await get("/api/haplotypes?linkage_group=1"),
    group2: await get("/api/haplotypes?linkage_group=2"),
  };
}

test("FlexQTL file saved as JSON and opened again: the same data", async ({ page }) => {
  await page.goto("/");
  await page.getByText(/individuals/).first().waitFor();
  const ped = zlib.gunzipSync(fs.readFileSync(path.resolve("../backend/tests/fixtures/flexqtl_binko/flexqtl_routeB_sim_small.ped.gz")));
  await upload(page, ped, "flexqtl_routeB_sim_small.ped");
  const before = await snapshot();

  const button = page.getByRole("button", { name: "Save as JSON" });
  await expect(button).toHaveAttribute("title", /whole population/);
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toBe("sim_small_fq.json");     // POPULATION = sim_small_fq.dat
  const saved = fs.readFileSync((await download.path())!);
  const json = JSON.parse(saved.toString("utf-8"));
  expect([json.format, json.format_version]).toEqual(["pedimap2-json", 1]);

  const reply = await upload(page, saved, "flexqtl_routeB_sim_small.json");
  expect(reply.loaded).toBe("json");
  expect(reply.warnings).toEqual([]);
  expect(await snapshot()).toEqual(before);
  await expect(page.getByText(`${before.individuals.length} individuals`)).toBeVisible();
});
