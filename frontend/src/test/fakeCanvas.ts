// A stand-in 2D canvas context for jsdom, which has none. vis-network needs
// one to size node labels before laying out the chart; this one measures text
// at a fixed width per character and ignores drawing calls, so the layout is
// computed exactly as in the app, with slightly different label widths.

const CHAR_WIDTH = 0.6;   // × font size

function fakeContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { font: "10px sans-serif", canvas };
  const noop = () => undefined;
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "measureText") {
        return (text: string) => {
          const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(String(target.font))?.[1] ?? "10");
          return { width: [...text].length * size * CHAR_WIDTH,
                   actualBoundingBoxAscent: size * 0.8, actualBoundingBoxDescent: size * 0.2 };
        };
      }
      if (prop === "getTransform") return () => new DOMMatrix();
      if (prop === "createLinearGradient" || prop === "createRadialGradient") {
        return () => ({ addColorStop: noop });
      }
      if (prop === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
      return noop;
    },
    set(target, prop, value) { target[prop] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
}

export function installFakeCanvas() {
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    return fakeContext(this);
  } as never;
}
