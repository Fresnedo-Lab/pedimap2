// The interface is in American English (CLAUDE.md, CONTRIBUTING.md). Every
// frontend source file is checked, comments included, so that no British
// spelling can reach a label, tooltip, legend, warning or dialog.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SELF = resolve("src/lib/spelling.test.ts");

/** British spellings (with their inflections), and the American form. */
const BRITISH: [RegExp, string][] = [
  [/\bcolour/i, "color"],
  [/\bbehaviour/i, "behavior"],
  [/\banalys(e|es|ed|ing)\b/i, "analyze"],
  [/\bcentre/i, "center"],
  [/\blicence/i, "license"],
  [/\bfavour/i, "favor"],
  [/\bcancell(ed|ing)\b/i, "canceled"],
  [/\bgrey\b/i, "gray"],
  [/\b(organ|recogn|visual|initial|normal|optim|serial|summar|priorit|custom|minim|maxim)is(e|es|ed|ing|ation)\b/i,
   "-ize"],
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "fixtures" || name === "assets" ? [] : sources(path);
    return /\.(tsx?|html|css)$/.test(name) && path !== SELF ? [path] : [];
  });
}

describe("American English", () => {
  it("no British spelling in the frontend's sources", () => {
    const files = [...sources(resolve("src")), ...sources(resolve("e2e")), resolve("index.html")];
    expect(files.length).toBeGreaterThan(20);
    const found: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf-8").split("\n").forEach((line, i) => {
        for (const [pattern, american] of BRITISH) {
          const m = line.match(pattern);
          if (m) found.push(`${relative(resolve("."), file)}:${i + 1}: "${m[0]}" (American: ${american})`);
        }
      });
    }
    expect(found).toEqual([]);
  });

  it("catches each British form", () => {
    for (const s of ["Colour by", "behaviours", "analyse", "centred", "licence", "favourite",
                     "cancelled", "grey", "summarised", "Initialisation"]) {
      expect(BRITISH.some(([p]) => p.test(s)), s).toBe(true);
    }
    for (const s of ["Color by", "analysis", "center", "license", "canceled", "otherwise", "precise"]) {
      expect(BRITISH.some(([p]) => p.test(s)), s).toBe(false);
    }
  });
});
