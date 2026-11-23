// Image export with IBD bars, in WebKit (design §7): the exported SVG carries
// the founder-allele legend beside the chart, and the PNG made from it has the
// SVG's size (at PNG_SCALE) with the legend's swatches in their colors.

import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const backendPort = Number(process.env.E2E_BACKEND_PORT ?? 8765);
const backend = `http://127.0.0.1:${backendPort}`;
const PNG_SCALE = 2;                                   // chart/imageExport.ts

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
  await page.getByLabel("IBD bars").selectOption({ index: 1 });          // linkage group 1
}

async function exportAs(page: Page, format: "svg" | "png"): Promise<Buffer> {
  await page.getByRole("button", { name: /Export image/ }).click();
  await page.locator(`input[name="image-format"][value="${format}"]`).check();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save…" }).click()]);
  return fs.readFileSync((await download.path())!);
}

for (const orientation of ["↓ Top to bottom", "→ Left to right"] as const) {
  test(`FlexQTL with IBD bars, ${orientation}: SVG and PNG carry the founder-allele legend`, async ({ page }) => {
    await loadFlexQtl(page);
    await page.getByRole("button", { name: orientation, exact: true }).click();
    await page.waitForTimeout(500);

    const svg = (await exportAs(page, "svg")).toString("utf-8");
    // Measured by WebKit on the exported drawing.
    const legend = await page.evaluate((text) => {
      const host = document.createElement("div");
      host.innerHTML = text.replace(/^<\?xml[^>]*>/, "");
      document.body.appendChild(host);
      const svgEl = host.querySelector("svg")!;
      const box = (el: Element) => (el as SVGGraphicsElement).getBoundingClientRect();
      const origin = box(svgEl);
      const nodes = [...svgEl.querySelectorAll("g.node")].map(box);
      const block = svgEl.querySelector("g.founder-alleles")!;
      const swatches = [...block.querySelectorAll("rect.legend-swatch[data-allele]")].map(s => {
        const r = box(s);
        return { allele: s.getAttribute("data-allele"), color: s.getAttribute("fill")!,
                 x: r.left - origin.left + r.width / 2, y: r.top - origin.top + r.height / 2 };
      });
      // In each row, the founder's name ends before its first swatch, and each
      // allele number before the next swatch (WebKit's own text metrics).
      const overlaps: string[] = [];
      for (const row of block.querySelectorAll("g.legend-row")) {
        const items = [...row.children].map(el => ({ el, r: box(el) })).sort((a, b) => a.r.left - b.r.left);
        for (let i = 1; i < items.length; i++) {
          if (items[i - 1].r.right > items[i].r.left + 0.5) overlaps.push(`${row.getAttribute("data-founder")}: ${items[i - 1].el.textContent || "swatch"}`);
        }
      }
      // Swatches and numbers in fixed columns: within a legend column (rows
      // whose names start at the same x), each slot's swatches share one x,
      // and so do their numbers.
      const slots = new Map<string, { swatch: Set<number>; number: Set<number> }>();
      for (const row of block.querySelectorAll("g.legend-row")) {
        const column = Math.round(box(row.querySelector("text.founder")!).left);
        for (const s of row.querySelectorAll("rect.legend-swatch")) {
          const key = `${column}/${s.getAttribute("data-slot")}`;
          if (!slots.has(key)) slots.set(key, { swatch: new Set(), number: new Set() });
          slots.get(key)!.swatch.add(Math.round(box(s).left * 10) / 10);
          slots.get(key)!.number.add(Math.round(box(s.nextElementSibling!).left * 10) / 10);
        }
      }
      const b = box(block);
      const result = {
        slots: [...slots.entries()].map(([key, v]) => ({ key, swatch: [...v.swatch], number: [...v.number] })),
        title: block.querySelector("text.legend-title")?.textContent,
        overlaps,
        rowRights: [...block.querySelectorAll("g.legend-row")].map(r => ({ left: box(r.querySelector("text")!).left, right: box(r).right })),
        rows: block.querySelectorAll("g.legend-row").length,
        swatches,
        chart: { right: Math.max(...nodes.map(n => n.right)) - origin.left, bottom: Math.max(...nodes.map(n => n.bottom)) - origin.top },
        legend: { left: b.left - origin.left, top: b.top - origin.top },
        width: Number(svgEl.getAttribute("width")), height: Number(svgEl.getAttribute("height")),
      };
      host.remove();
      return result;
    }, svg);

    expect(legend.title).toBe("Founder alleles, linkage group 1 (below 0.10 merged)");
    expect(legend.rows).toBe(29);
    expect(legend.overlaps).toEqual([]);
    // Columns do not run into each other: every row ends left of the next
    // column's names.
    const columns = [...new Set(legend.rowRights.map(r => Math.round(r.left)))].sort((a, b) => a - b);
    for (const r of legend.rowRights) {
      const next = columns.find(c => c > Math.round(r.left));
      if (next !== undefined) expect(r.right).toBeLessThan(next);
    }
    expect(legend.swatches).toHaveLength(58);
    expect(legend.slots.length).toBeGreaterThanOrEqual(2);
    for (const slot of legend.slots) {
      expect(slot.swatch, `swatch x in slot ${slot.key}`).toHaveLength(1);
      expect(slot.number, `number x in slot ${slot.key}`).toHaveLength(1);
    }
    if (orientation === "↓ Top to bottom") expect(legend.legend.top).toBeGreaterThan(legend.chart.bottom);
    else expect(legend.legend.left).toBeGreaterThan(legend.chart.right);

    // The PNG: the SVG's size at PNG_SCALE, and the swatches in their colors.
    const png = (await exportAs(page, "png")).toString("base64");
    const samples = [legend.swatches[0], legend.swatches[29], legend.swatches[57]];
    const seen = await page.evaluate(async ({ png, samples, scale }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const hex = (v: number) => v.toString(16).padStart(2, "0");
      return {
        width: img.naturalWidth, height: img.naturalHeight,
        colors: samples.map(s => {
          const [r, g, b] = ctx.getImageData(Math.round(s.x * scale), Math.round(s.y * scale), 1, 1).data;
          return `#${hex(r)}${hex(g)}${hex(b)}`;
        }),
      };
    }, { png, samples, scale: PNG_SCALE });
    expect(seen.width).toBe(Math.round(legend.width * PNG_SCALE));
    expect(seen.height).toBe(Math.round(legend.height * PNG_SCALE));
    const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    samples.forEach((s, i) => {
      const d = rgb(seen.colors[i]).map((v, k) => Math.abs(v - rgb(s.color)[k]));
      expect(Math.max(...d), `allele ${s.allele}: ${seen.colors[i]} for ${s.color}`).toBeLessThanOrEqual(3);
    });
  });
}
