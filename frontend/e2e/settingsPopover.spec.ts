// The ⚙ settings popover lays out inside its own box in WebKit (the macOS
// app's engine): its text wraps, and both number inputs are visible. The
// toolbar's button labels, meanwhile, still never wrap.

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

// Runs in the page: everything drawn inside `root` (elements and the lines of
// each text) that sticks out of root's box, by more than half a pixel.
function outside(root: Element) {
  const box = root.getBoundingClientRect();
  const out = (r: DOMRect) => r.width > 0 && r.height > 0 &&
    (r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5);
  const found: string[] = [];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (out(el.getBoundingClientRect())) found.push(`<${el.tagName.toLowerCase()}> ${(el.textContent ?? "").trim().slice(0, 40)}`);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const range = document.createRange();
    range.selectNodeContents(node);
    if (Array.from(range.getClientRects()).some(out)) found.push(`text "${node.textContent!.trim().slice(0, 40)}"`);
  }
  return found;
}

// Runs in the page: toolbar buttons whose label takes more than one line.
function wrappedToolbarLabels() {
  const toolbar = document.querySelector('[role="toolbar"]')!;
  return Array.from(toolbar.querySelectorAll("button"))
    .filter(b => !b.closest('[role="dialog"]') && (b.textContent ?? "").trim())
    .filter(b => {
      const range = document.createRange();
      range.selectNodeContents(b);
      return new Set(Array.from(range.getClientRects()).map(r => Math.round(r.top))).size > 1;
    })
    .map(b => b.textContent!.trim());
}

async function openSettings(page: Page, width: number, ibd = false) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await page.getByText(/individuals/).first().waitFor();
  if (ibd) {
    // A file with IBD data, so the popover has its "IBD bars" section.
    const file = path.resolve("../backend/tests/fixtures/flexqtl_binko/flexqtl_routeB_sim_small.ped.gz");
    const form = new FormData();
    form.append("dat_file", new Blob([zlib.gunzipSync(fs.readFileSync(file))]), "flexqtl_routeB_sim_small.ped");
    expect((await fetch(`${backend}/api/load`, { method: "POST", body: form })).ok).toBe(true);
    await page.reload();
    await page.getByText(/individuals/).first().waitFor();
  }
  await page.getByTitle("Settings").click();
  return page.getByRole("dialog", { name: "Settings" });
}

for (const [width, ibd] of [[820, false], [1440, false], [820, true], [1440, true]] as const) {
  test(`settings popover lays out within its box at ${width} px${ibd ? ", with its IBD bars section" : ""}`, async ({ page }) => {
    const popover = await openSettings(page, width, ibd);
    await expect(popover).toBeVisible();
    expect(await popover.evaluate(outside)).toEqual([]);

    // The number inputs and the palette choice are shown, whole, inside the popover.
    const box = (await popover.boundingBox())!;
    const inputs = [page.getByLabel("Cross symbol size (px)"), page.getByLabel("Drawing limit")];
    // (Whether the section shows depends on the file the shared backend holds;
    // the App tests check that a file without IBD data has none.)
    if (ibd) inputs.push(page.getByLabel("Bar width (px)"), page.getByLabel("Palette"));
    for (const input of inputs) {
      await expect(input).toBeVisible();
      const r = (await input.boundingBox())!;
      expect(r.width).toBeGreaterThan(30);
      expect(r.x >= box.x && r.x + r.width <= box.x + box.width + 0.5).toBe(true);
    }

    // The toolbar's labels still never wrap.
    expect(await page.evaluate(wrappedToolbarLabels)).toEqual([]);
  });
}
