// Names, never ids, in WebKit: in the demo data the ids differ from the names
// (G1_03 is WA-103, G2_04 is SEL-204). Every place that names an individual
// shows its name: the details panel, the Subpop button, the subpopulation's
// export panel, file names and .dat comment. Save as JSON suggests the
// population's name, also while a subpopulation is shown.

import { test, expect } from "@playwright/test";
import fs from "node:fs";

const backendPort = Number(process.env.E2E_BACKEND_PORT ?? 8765);

test.beforeEach(async ({ page }) => {
  if (backendPort !== 8765) {
    await page.route("http://127.0.0.1:8765/**", async route =>
      route.fulfill({ response: await route.fetch({ url: route.request().url().replace(":8765", `:${backendPort}`) }) }));
  }
});

/** Demo-data ids: F01–F06 and G1_01–G3_06, never shown. */
const DEMO_ID = /\b(F0\d|G\d_\d\d)\b/;

test("the demo data's individuals are named by name, never by id", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "↺ Demo Data" }).click();
  await page.getByText(/Apple Breeding Program – Demo · \d+ individuals/).waitFor();

  await page.getByText("SEL-204", { exact: true }).first().click();
  const details = page.getByRole("complementary", { name: "Details" });
  await expect(details.getByRole("button", { name: "WA-103" })).toHaveAttribute("title", "G1_03");
  await expect(details.getByRole("button", { name: "WA-104" })).toHaveAttribute("title", "G1_04");
  await details.getByRole("button", { name: /ancestors?$/ }).click();
  expect(await details.innerText()).not.toMatch(DEMO_ID);

  const subpop = page.getByRole("button", { name: /Subpop:/ });
  await expect(subpop).toHaveText(/Subpop: SEL-204$/);
  await subpop.click();
  // Shown once the subpopulation is: the export button then says so.
  const exportSubpop = page.getByRole("button", { name: /Export subpopulation \(\.dat\)/ });
  await expect(exportSubpop).toBeVisible();
  await exportSubpop.click();
  const panel = page.getByRole("dialog", { name: "Export subpopulation" });
  await expect(panel).toContainText(/individuals around SEL-204/);
  const [dat] = await Promise.all([page.waitForEvent("download"),
                                   panel.getByRole("button", { name: "Save…" }).click()]);
  expect(dat.suggestedFilename()).toBe("Apple_Breeding_Program_Demo_SEL-204_subpop.dat");
  const text = fs.readFileSync((await dat.path())!, "utf-8");
  expect(text.split("\n")).toContain("; Focal individual: SEL-204");
  expect(text).not.toMatch(DEMO_ID);

  // The whole population, so its name only: no subpopulation in it.
  const [json] = await Promise.all([page.waitForEvent("download"),
                                    page.getByRole("button", { name: "Save as JSON" }).click()]);
  expect(json.suggestedFilename()).toBe("Apple_Breeding_Program_Demo.json");

  // Nothing on the page names an individual by its id.
  expect(await page.locator("body").innerText()).not.toMatch(DEMO_ID);
});
