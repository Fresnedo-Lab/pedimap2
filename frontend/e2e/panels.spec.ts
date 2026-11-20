// The details panel's Markers and IBD sections, colouring by a marker, and the
// marker data summary, in WebKit on the simulated FlexQTL/Binko fixtures and
// Example.dat.
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const backendPort = Number(process.env.E2E_BACKEND_PORT ?? 8765);
const backend = `http://127.0.0.1:${backendPort}`;

test.beforeEach(async ({ page }) => {
  // The app calls the backend at 127.0.0.1:8765; follow it to another port.
  if (backendPort !== 8765) {
    await page.route("http://127.0.0.1:8765/**", async route =>
      route.fulfill({ response: await route.fetch({ url: route.request().url().replace(":8765", `:${backendPort}`) }) }));
  }
});

async function load(page: Page, fixture: string) {
  const file = path.resolve("../backend/tests/fixtures", fixture);
  const gz = file.endsWith(".gz");
  const bytes = gz ? zlib.gunzipSync(fs.readFileSync(file)) : fs.readFileSync(file);
  const form = new FormData();
  form.append("dat_file", new Blob([bytes]), path.basename(file, gz ? ".gz" : undefined));
  expect((await fetch(`${backend}/api/load`, { method: "POST", body: form })).ok).toBe(true);
  await page.goto("/");
  await page.getByText(/individuals/).first().waitFor();
}

async function select(page: Page, name: string) {
  await page.getByPlaceholder("Search individuals…").fill(name);
  await page.getByText(name, { exact: true }).first().click();
  await expect(page.getByText(name, { exact: true }).nth(1)).toBeVisible();   // panel header
}

test("Markers section: alleles in file order, code badges with their meaning", async ({ page }) => {
  await load(page, "flexqtl_binko/binko_legacy.ped");
  await select(page, "G1_001");
  const markers = page.getByRole("region", { name: "Markers" });
  await expect(markers.locator("thead th")).toHaveText(["Locus", "Parent 1", "Parent 2", "Code"]);
  const row = markers.locator('tr[data-marker="M1_001"] td');
  await expect(row).toHaveText(["M1_001", "G", "A", "1"]);
  await expect(markers.locator('tr[data-marker="M1_001"] [data-code="1"]'))
    .toHaveAttribute("title", /^Code 1 \(MA\)/);

  await select(page, "DUMMY_G1_007_F");
  await expect(page.getByRole("region", { name: "Markers" })).toContainText("No genotype data");
});

test("IBD section: each FlexQTL linkage group shows its own positions", async ({ page }) => {
  await load(page, "flexqtl_binko/flexqtl_routeB_sim_small.ped.gz");
  await select(page, "G1_001");
  const ibd = page.getByRole("region", { name: "IBD" });
  const first = ibd.getByLabel("Homologue from Parent 1");
  await expect(first).toHaveText("Homologue from parent 10.95F003 · founder allele 23");
  await expect(ibd.getByLabel("IBD position").locator("option")).toHaveCount(21);

  const group1 = await first.textContent();
  await ibd.getByLabel("IBD linkage group").selectOption("2");
  await expect(ibd.getByLabel("IBD position")).toHaveValue("0.000");
  await expect(ibd.getByLabel("IBD position").locator("option")).toHaveCount(21);
  await expect(first).not.toHaveText(group1!);
});

test("Colour by genotype code at a marker, with a legend; the marker data summary", async ({ page }) => {
  await load(page, "flexqtl_binko/binko_legacy.ped");
  await page.getByLabel("Colour by").selectOption({ label: "Genotype code at marker…" });
  await page.getByLabel("Marker", { exact: true }).selectOption("M1_001");
  const legend = page.getByRole("group", { name: "Legend: Genotype code at M1_001" });
  await expect(legend).toContainText("0 · OC");
  await expect(legend).toContainText("No genotype data");

  await page.getByLabel("Colour by").selectOption({ label: "Allele at marker…" });
  await expect(page.getByRole("group", { name: "Legend: Copies of allele A at M1_001" })).toBeVisible();

  await page.getByRole("button", { name: /Marker data/ }).click();
  const summary = page.getByRole("dialog", { name: "Marker data" });
  await expect(summary).toContainText("11 loci on 3 linkage groups");
  await expect(summary).toContainText("264 genotype rows for 24 individuals");
});

test("Example.dat: parents labeled by sex, as its caption says", async ({ page }) => {
  await page.goto("/");
  await page.getByText(/individuals/).first().waitFor();
  await page.getByRole("button", { name: /Load Example Data/ }).click();
  await select(page, "Elstar");
  await expect(page.getByText("Female parent").first()).toBeVisible();
  const markers = page.getByRole("region", { name: "Markers" });
  await expect(markers.locator('tr[data-marker="SSR1"] td')).toHaveText(["SSR1", "180", "$", "2"]);
  // No FACTOR0 in Example.dat's caption: its codes are colour codes, not FlexQTL's classes.
  await expect(markers.locator('tr[data-marker="SSR1"] [data-code="2"]')).toHaveAttribute("title", "Colour code 2");
  await page.getByLabel("Colour by").selectOption({ label: "Genotype code at marker…" });
  await page.getByLabel("Marker", { exact: true }).selectOption("SSR1");
  const legend = page.getByRole("group", { name: "Legend: Genotype code at SSR1" });
  await expect(legend).toContainText("Code 2");
  await expect(legend).not.toContainText("OEA");
});
