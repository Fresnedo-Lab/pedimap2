// Typing in a text field never moves the chart: vis-network's keyboard
// navigation and our own shortcuts act only when the chart has focus.
import { test, expect, type Page } from "@playwright/test";

const backendPort = Number(process.env.E2E_BACKEND_PORT ?? 8765);

test.beforeEach(async ({ page }) => {
  if (backendPort !== 8765) {
    await page.route("http://127.0.0.1:8765/**", async route =>
      route.fulfill({ response: await route.fetch({ url: route.request().url().replace(":8765", `:${backendPort}`) }) }));
  }
});

/** The chart as drawn: the canvas's pixels. */
const chartPixels = (page: Page) =>
  page.evaluate(() => document.querySelector<HTMLCanvasElement>("canvas")!.toDataURL());

test("typing in the search box types, and leaves the chart where it is", async ({ page }) => {
  await page.goto("/");
  await page.getByText(/individuals/).first().waitFor();
  await page.getByRole("button", { name: /Load Example Data/ }).click();
  await page.waitForTimeout(1200);                          // layout, fit and first frames
  const before = await chartPixels(page);

  const search = page.getByPlaceholder("Search individuals…");
  for (const text of ["G1_001", "81015-045"]) {
    await search.click();
    await search.fill("");
    await page.keyboard.type(text, { delay: 30 });          // real key presses: "_" and "-" included
    await expect(search).toHaveValue(text);
    await page.waitForTimeout(400);
    expect(await chartPixels(page), `typing "${text}" moved the chart`).toBe(before);
  }
  // "f" in the search box types too; it does not fit the chart.
  await search.fill("");
  await page.keyboard.type("Coffee", { delay: 30 });
  await expect(search).toHaveValue("Coffee");

  // With the chart focused, its keys work: "-" zooms out.
  await search.fill("");
  const canvas = page.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + 8, box.y + 8);             // an empty corner of the chart
  await page.waitForTimeout(300);
  const focused = await chartPixels(page);
  await page.keyboard.press("-");
  await page.waitForTimeout(400);
  expect(await chartPixels(page), "the focused chart did not zoom").not.toBe(focused);
});
