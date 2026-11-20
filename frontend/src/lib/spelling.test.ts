// Pedimap 2 is written in American English (CLAUDE.md, CONTRIBUTING.md). Every
// frontend source file is checked, comments included, so that no British
// spelling can reach a label, tooltip, legend, warning or dialog; and so are
// the README, CHANGELOG, CONTRIBUTING and everything under docs/.
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO = resolve("..");
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

/** Quotations, each kept exactly as written: a line of `file` that contains
 *  `quote` may spell it so. */
const QUOTED: { file: string; quote: string; why: string }[] = [
  { file: "CHANGELOG.md", quote: '(was "Colour', why: "2.3.0 names the label it replaced" },
  { file: "CHANGELOG.md", quote: "**Colour by**; the chart and the export legend use them.",
    why: "the 2.2.0 entry gives the label of that release" },
  { file: "docs/announcements/2.2.0-email.md", quote: "to **Colour by**.",
    why: "the 2.2.0 announcement gives the label of that release" },
  { file: "docs/reference/flexqtl-binko-pedimap/pedimap-input-file-reader-spec.md",
    quote: "; Output from FlexQTL software for visualisation by Pedimap software",
    why: "FlexQTL's own first line, quoted from its files" },
];

function files(dir: string, extensions: RegExp, skip = (_name: string) => false): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return skip(name) ? [] : files(path, extensions, skip);
    return extensions.test(name) && path !== SELF ? [path] : [];
  });
}

function britishIn(paths: string[]): string[] {
  const found: string[] = [];
  for (const path of paths) {
    const file = relative(REPO, path);
    readFileSync(path, "utf-8").split("\n").forEach((line, i) => {
      if (QUOTED.some(q => q.file === file && line.includes(q.quote))) return;
      for (const [pattern, american] of BRITISH) {
        const m = line.match(pattern);
        if (m) found.push(`${file}:${i + 1}: "${m[0]}" (American: ${american})`);
      }
    });
  }
  return found;
}

describe("American English", () => {
  it("no British spelling in the frontend's sources", () => {
    const skip = (name: string) => name === "fixtures" || name === "assets";
    const sources = [...files(resolve("src"), /\.(tsx?|css)$/, skip),
                     ...files(resolve("e2e"), /\.ts$/), resolve("index.html")];
    expect(sources.length).toBeGreaterThan(20);
    expect(britishIn(sources)).toEqual([]);
  });

  it("no British spelling in the README, CHANGELOG, CONTRIBUTING or docs/", () => {
    const docs = [...["README.md", "CHANGELOG.md", "CONTRIBUTING.md"].map(f => join(REPO, f)),
                  ...files(join(REPO, "docs"), /\.(md|jl|txt)$/)];
    expect(docs.length).toBeGreaterThan(10);
    expect(britishIn(docs)).toEqual([]);
  });

  it("allows only quotations that are still there", () => {
    for (const q of QUOTED) {
      const path = join(REPO, q.file);
      expect(existsSync(path) && readFileSync(path, "utf-8").includes(q.quote), `${q.file}: ${q.why}`).toBe(true);
    }
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
