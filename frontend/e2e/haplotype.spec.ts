// The haplotype display across dataset loads: the IBD linkage group follows
// the file loaded, and no request goes out for a group it does not have.
import { test, expect } from "@playwright/test";
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

test("FlexQTL with bars on group 1, then Example.dat: group A, no error", async ({ page }) => {
  const form = new FormData();
  form.append("dat_file", new Blob([zlib.gunzipSync(fs.readFileSync(path.resolve(
    "../backend/tests/fixtures/flexqtl_binko/flexqtl_routeB_sim_small.ped.gz")))]), "sim_small.ped");
  expect((await fetch(`${backend}/api/load`, { method: "POST", body: form })).ok).toBe(true);
  await page.goto("/");
  await page.getByText(/individuals/).first().waitFor();
  await page.getByLabel("IBD bars").selectOption("1");
  await expect(page.getByLabel("IBD bars")).toHaveValue("1");
  await page.waitForTimeout(800);

  const asked: string[] = [];
  page.on("request", r => {
    const url = new URL(r.url());
    if (url.pathname === "/api/haplotypes") asked.push(url.searchParams.get("linkage_group")!);
  });
  await page.getByRole("button", { name: /Load Example Data/ }).click();
  await expect(page.getByLabel("IBD bars")).toHaveValue("A");
  await page.waitForTimeout(800);
  expect(asked).toEqual(["A"]);
  await expect(page.getByText(/no IBD positions|API \d/)).toHaveCount(0);
  // The bars are drawn: the export holds the haplotype boxes.
  await page.getByRole("button", { name: /Export image/ }).click();
  await page.locator('input[name="image-format"][value="svg"]').check();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save…" }).click()]);
  expect(fs.readFileSync((await download.path())!, "utf-8")).toContain('class="node haplotype"');
});
