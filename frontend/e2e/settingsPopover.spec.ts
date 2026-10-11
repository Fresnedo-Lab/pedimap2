// The ⚙ settings popover lays out inside its own box in WebKit (the macOS
// app's engine): its text wraps, and both number inputs are visible. The
// toolbar's button labels, meanwhile, still never wrap.

import { test, expect, type Page } from "@playwright/test";

const backendPort = Number(process.env.E2E_BACKEND_PORT ?? 8765);

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

async function openSettings(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await page.getByText(/individuals/).first().waitFor();
  await page.getByTitle("Settings").click();
  return page.getByRole("dialog", { name: "Settings" });
}

for (const width of [820, 1440]) {
  test(`settings popover lays out within its box at ${width} px`, async ({ page }) => {
    const popover = await openSettings(page, width);
    await expect(popover).toBeVisible();
    expect(await popover.evaluate(outside)).toEqual([]);

    // Both number inputs are shown, whole, inside the popover.
    const box = (await popover.boundingBox())!;
    for (const input of [page.getByLabel("Cross symbol size (px)"), page.getByLabel("Drawing limit")]) {
      await expect(input).toBeVisible();
      const r = (await input.boundingBox())!;
      expect(r.width).toBeGreaterThan(30);
      expect(r.x >= box.x && r.x + r.width <= box.x + box.width + 0.5).toBe(true);
    }

    // The toolbar's labels still never wrap.
    expect(await page.evaluate(wrappedToolbarLabels)).toEqual([]);
  });
}
