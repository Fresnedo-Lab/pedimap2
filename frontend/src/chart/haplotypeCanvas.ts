// chart/haplotypeCanvas.ts
// ========================
// Draws a haplotype box (lib/haplotype.ts, haplotypeBox) on the canvas. The
// image export writes the same items as SVG (chart/svgExport.ts), so the two
// show the same box.

import type { HaplotypeBox } from "../lib/haplotype";
import { HATCH } from "./svgExport";
import type { StyleTheme } from "./style";

export interface DrawOptions {
  theme:    StyleTheme;
  selected: boolean;
  /** The box fill is the hatched gray of an unknown value (HATCH). */
  hatched:  boolean;
  /** Rounded corners (Modern) or square ones (Classic). */
  radius:   number;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (r <= 0) { ctx.rect(x, y, w, h); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The hatch's light stripes over the rectangle (clip to it first). */
function hatchLines(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number) {
  ctx.strokeStyle = HATCH.ink;
  ctx.lineWidth = HATCH.width;
  ctx.beginPath();
  const step = HATCH.spacing * Math.SQRT2;
  for (let x = -h; x < w; x += step) { ctx.moveTo(x0 + x, y0 + h); ctx.lineTo(x0 + x + h, y0); }
  ctx.stroke();
}

/** Draw `box` with its top left corner at (left, top). */
export function drawHaplotypeBox(ctx: CanvasRenderingContext2D, box: HaplotypeBox,
                                 left: number, top: number, opts: DrawOptions): void {
  const { theme } = opts;
  ctx.save();
  ctx.translate(left, top);
  for (const item of box.items) {
    switch (item.role) {
      case "box": {
        roundedRect(ctx, item.x, item.y, item.w, item.h, opts.radius);
        ctx.fillStyle = item.fill;
        ctx.fill();
        if (opts.hatched) {
          ctx.save();
          ctx.clip();
          hatchLines(ctx, item.x, item.y, item.w, item.h);
          ctx.restore();
        }
        roundedRect(ctx, item.x, item.y, item.w, item.h, opts.radius);
        ctx.strokeStyle = opts.selected ? theme.selected : item.stroke;
        ctx.lineWidth = opts.selected ? 3 : 1;
        ctx.stroke();
        break;
      }
      case "segment":
        ctx.fillStyle = item.fill;
        // A hair wider and taller, so neighboring segments leave no seam.
        ctx.fillRect(item.x, item.y, item.w + 0.25, item.h + 0.25);
        break;
      case "no-data":
        // No IBD rows: hatched, as every unknown value is drawn.
        ctx.save();
        ctx.beginPath();
        ctx.rect(item.x, item.y, item.w, item.h);
        ctx.fillStyle = HATCH.fill;
        ctx.fill();
        ctx.clip();
        hatchLines(ctx, item.x, item.y, item.w, item.h);
        ctx.restore();
        break;
      case "bar":
        ctx.strokeStyle = item.stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(item.x, item.y, item.w, item.h);
        break;
      case "position-tick":
      case "marker-tick":
        ctx.strokeStyle = item.stroke;
        ctx.lineWidth = item.role === "position-tick" ? 1 : 0.75;
        ctx.beginPath();
        ctx.moveTo(item.x1, item.y1);
        ctx.lineTo(item.x2, item.y2);
        ctx.stroke();
        break;
      case "name":
        ctx.fillStyle = item.color;
        ctx.font = `${item.fontSize}px ${theme.fontFace}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(item.text, item.x, item.y);
        break;
    }
  }
  ctx.restore();
}
