# Haplotype display — design (Phase C)

Status: **approved** (2026-11-20), with the decisions of §11. Implementation
follows the pull requests of §10.

Pedimap 1.x is a behavioral reference only (`docs/reference/ui-model.md`,
§6.3–6.4). No code is copied or ported from it.

## 0. What exists (2.3.0) and what this design builds on

- **Data, read and tested.** The reader (`backend/pmp_parser.py`) follows
  `docs/reference/flexqtl-binko-pedimap/`. For every linkage group with IBD
  positions, `engine.ibd[group][position][individual]` holds two homologue
  vectors of `NALLELES` probabilities, the first from the caption's first
  parent column. `dat_meta.founder_order` names the founder behind each pair of
  founder alleles (absent for an exported subset, whose founder alleles belong
  to its source population). Founders without IBD rows (Binko's dummy founders)
  already have rows supplied by the parser, probability 1 on their own two
  founder alleles (`dat_meta.supplied_ibd_rows`). **The parser is not changed
  by this work.**
- **Interface.** The details panel shows genotypes, codes and the most probable
  founder alleles per position (`backend/marker_data.py`,
  `IndividualPanel.tsx`). Code meanings are shown only when the caption has
  `FACTOR0` (`marker_summary.flexqtl_codes`).
- **Chart.** vis-network lays out invisible layout edges and waypoint nodes;
  links are drawn by `chart/routing.ts` from node boxes on the canvas and in
  every export, and `chart/linkRouting.test.tsx` (jsdom) plus
  `e2e/linkRouting.spec.ts` (WebKit, exported SVG) check that no link crosses a
  box it does not connect. Dragging stays within a node's row (`dragRange`).
  Cross symbols already use a vis-network custom shape (`ctxRenderer`).
- **Settings.** `ViewSettings` (App.tsx) already reserves
  `cellContents: "name" | "name+markers" | "name+ibd"`, `ibdLinkageGroup` and
  `selectedMarkers`; none is wired yet.
- **Sizes measured on the FlexQTL fixture** (`flexqtl_routeB_sim_small.ped`):
  `/api/pedigree` is 2.07 MB, of which the IBD data is 1.86 MB, and no screen
  uses it. One linkage group is 930 kB as dense vectors but 85 kB sparse: a
  homologue has 1.66 nonzero founder alleles on average and at most 6.

## 1. IBD bars

### 1.1 What is drawn

When a view's cell contents include IBD, each individual's box holds two
vertical bars for the view's linkage group: the homologue from the caption's
first parent column on the left, from the second on the right (as labeled in
the details panel: "Parent 1/Parent 2" or "Female/Male parent"). The bar's
length is the group's map; its top is the group's start.

- **Map scale.** The bar spans `[start, end]` of the group: `start` is the
  smallest of 0, the first marker position and the first IBD position; `end`
  the largest marker or IBD position. Positions map linearly onto the bar's
  height. Every box of a view uses the same bar height, so boxes stay regular.
- **Bands.** IBD position *i* (at *x<sub>i</sub>* cM) owns the stretch from the
  midpoint with its previous position to the midpoint with its next; the first
  and last positions extend to the bar's ends. This holds for a position
  between markers (`binko_ibd.ped`, 5 cM between 0 and 7.5) as for one at a
  marker. No probabilities are interpolated between positions.
- **Segments.** A band is split across the bar's width into segments, one per
  founder allele with nonzero probability, widths in proportion to the
  probabilities. Segments are ordered by founder-allele number, not by
  probability, so a recombination shows as a change of color between bands
  rather than a reshuffle. For drawing, the probabilities of a homologue are
  divided by their sum (FlexQTL's rounded values sum to 0.98–1.02); the values
  shown on hover are the values as read.
- **Narrow segments.** A segment narrower than one chart pixel (one pixel at
  100 % zoom) is merged into a single neutral segment (dark gray, see §2.4)
  at the band's end, so tiny probabilities do not turn into colored noise;
  hover lists them. The threshold is in chart units, not screen pixels, so the
  screen and the export (drawn at 100 %) merge the same segments. **The
  threshold therefore follows the bar width:** a bar *w* pixels wide merges
  probabilities below 1/*w* of a homologue (below 0.1 with the default
  10-pixel bar, below 0.05 at 20 pixels). Since the bar width decides which
  probabilities are drawn separately, its setting (PR 4) must be prominent:
  in the "Haplotypes" section of ⚙, next to the color scheme, with its effect
  stated ("probabilities below 0.10 are drawn as one gray remainder").
- **Founders without data** have rows supplied by the parser (probability 1 on
  their own alleles), so their bars show their own two founder alleles, one per
  homologue, like every founder. Nothing extra is needed.
- **A group without IBD positions** (`binko_ibd.ped`, group 2) is not offered
  in the group selector; the selector lists only groups with positions and
  defaults to the first.
- **Ticks.** A short tick on the outer side of each bar marks each actual IBD
  position, so the midpoint bands can be read against the positions they
  stand for. A second, optional kind of tick marks the group's markers that
  are not IBD positions (on by default), so bands can be read against loci
  too; a marker at an IBD position already has that tick.

### 1.2 Data

A new endpoint sends one linkage group at a time, sparse:

```
GET /api/haplotypes?linkage_group=1
{ "linkage_group": "1", "start_cM": 0, "end_cM": 100,
  "positions": [{"position": "0.000", "cM": 0.0}, ...],
  "markers":   [{"name": "M1_001", "cM": 0.0, "position": "0.000" | null}, ...],
  "nalleles": 58, "founders": ["DUMMY_G1_007_M", ...] | null,
  "founder_alleles": {"M1_001": ["-", "-", ..., "G", "A"], ...},
  "rows": {"G1_001": [[[23, 0.95], [24, 0.05]], [[38, 1.0]]], ...} }
```

`rows[id][h][k]` lists, for position *k*, the nonzero `[founder allele,
probability]` pairs of homologue *h*. `founders` is `null` for an exported
subset; the display then names founder alleles by number only. The response
is cached per group in the frontend.

Separately, `/api/pedigree` stops sending `ibd` (§10, PR 1), which takes the
FlexQTL file's reply from 2.07 MB to 0.21 MB. The JSON export
(`/api/export/json`) keeps everything. Measured on the fixtures:
`/api/haplotypes` sends 75 kB for one FlexQTL group and 396 kB for the
synthetic 300-individual group of §8.

## 2. Color schemes

### 2.1 The three schemes

| Scheme | Founder alleles | Use |
|---|---|---|
| **By founder** (default) | Each founder a hue; its first founder allele a light shade, its second a dark shade | Following which founder a segment descends from |
| **By founder allele** | Each founder allele its own color | Telling a founder's two alleles apart everywhere |
| **Highlight** | Everything a light neutral gray; up to 8 chosen founder alleles in strong colors | Following a few founder alleles through a large pedigree |

These correspond to the founder-allele color presets of the UI model (§6.3),
with "by founder" as the default.

### 2.2 How colors are generated

Colors are chosen from a grid in OKLCH (perceptually even lightness and hue:
36 hues, four chromas, several lightnesses, clamped to sRGB) and stored as
fixed sequences in `frontend/src/lib/palettes.ts`, written by
`paletteGenerator.ts`:

- **By founder.** Founder *r* (its rank among the contributing founders, see
  below) takes pair *r* of a sequence of pairs of shades of one hue (light for
  its first founder allele, dark for its second; 0.22 or 0.30 apart in
  lightness). The sequence is built greedily: each next pair is the candidate
  farthest (CIEDE2000) from every color already chosen, under normal vision
  and the three simulated color-vision deficiencies at once, so the first few
  pairs, all a subpopulation usually needs, are the most separated. Up to 22
  contributing founders use this sequence; beyond that, a second sequence,
  refined so that the whole set is as separated as possible, separates them
  better (§2.5). No generated color comes within ΔE 10 of the remainder gray
  (§2.4), under any of the four visions. Beyond the 30 stored pairs, colors
  continue around the hue
  circle by the golden angle, and telling them apart relies on the legend,
  the hover and the highlight scheme.
- **By founder allele.** A greedy sequence of 60 single colors, built the same
  way.
- **Highlight.** Highlights take the eight colors of the Okabe–Ito set (chosen
  for color-blind viewers), in order; everything else is `#E5E7EB`.

The first draft generated colors by formula (golden-angle hues at fixed
lightness pairs). Measured, it kept 58 alleles ΔE 7.1 apart for normal vision
but collapsed under the simulations (ΔE 0.0 under deuteranopia), and kept the
4 founders of G3_010 only ΔE 2.1 apart under protanopia; hence the generated
sequences.

**Which founders get colors: the contributing founders.** The palette is
assigned only over the founders that contribute IBD probability to the
individuals currently displayed (the whole population or the
subpopulation): a founder contributes when one of its founder alleles has a
nonzero probability at some position of the view's linkage group in a
displayed individual's rows. A displayed founder always contributes (its own
row is 1 on its own alleles). The legend lists exactly the contributing
founders (by founder allele, exactly their founder alleles), so a
subpopulation gets a compact palette with large differences, and nothing in
the legend is absent from the chart. The assignment is stable for a given set
of displayed individuals and group: ranks follow the founder order.

### 2.3 Distinguishable at 58 founder alleles: what is promised

No palette makes 58 colors individually nameable at a glance. The design
promises measurable separation, and gives other ways to identify an allele
where color alone cannot:

- **Guarantees** (CIEDE2000 ΔE between any two founder-allele colors, the
  smallest over normal vision and simulated protanopia, deuteranopia and
  tritanopia, Machado et al. 2009). These are the measured values of the
  stored palettes, and `palettes.test.ts` keeps them as lower bounds:

  | Contributing founders (by founder) | 4 | 8 | 12 | 22 | 30 |
  |---|---|---|---|---|---|
  | Closest pair, ΔE ≥ | 11.9 | 7.3 | 6.4 | 4.2 | 4 |

  | Founder alleles (by founder allele) | 8 | 16 | 30 | 58 |
  |---|---|---|---|---|
  | Closest pair, ΔE ≥ | 11.8 | 8.7 | 6.3 | 4.5 |

  A founder's two shades are ΔE ≥ 15 apart (measured: at least 17.7). The
  draft's targets (ΔE ≥ 12 up to 12 founders, ≥ 5 at 29) proved out of reach
  when all four visions must hold at once: color-blind vision leaves
  essentially two dimensions (lightness and blue–yellow) for the colors to
  spread in. Above about 12 founders, a pair of colors can therefore be
  similar, and identifying a founder allele relies on what follows.
- **Beyond color:** hover (§9) names the founder allele, its founder and the
  probability; the legend (§7) lists exactly the founder alleles shown; the
  highlight scheme isolates a few; and in the details panel the same data is
  available as text.
- **Color-blind aware:** the palettes are chosen and measured under the three
  simulated deficiencies as well as normal vision, a founder's two shades
  differ in lightness, and the highlight scheme uses Okabe–Ito.

### 2.4 Neutral fills

- Narrow-segment remainder (§1.1): `#4B5563`, a dark neutral gray. Under all
  four visions it is at least ΔE 10 from every generated palette color (the
  generator excludes candidates closer than that), 17 from the highlight
  colors, 30 from the hatched gray of an unknown value (`#9CA3AF`) and 47 from
  the light gray of the hatch's stripes and of the highlight scheme
  (`#E5E7EB`); `palettes.test.ts` checks these. (The first choice,
  `#D1D5DB`, was only ΔE 4.2 from that light gray.)
- Highlight scheme, not highlighted: `#E5E7EB`.
- A founder allele of a subset whose founders are not named: its color by
  number, legend by number.

### 2.5 Measured separation (FlexQTL fixture)

Closest pair of founder-allele colors, by founder, CIEDE2000 (the same on
both linkage groups, which have the same contributing founders):

| Displayed | Contributing founders | Normal | Protanopia | Deuteranopia | Tritanopia | A founder's two shades |
|---|---|---|---|---|---|---|
| Whole population | 29 (58 founder alleles) | 4.58 | 4.20 | 4.04 | 4.20 | ≥ 17.8 |
| Subpopulation of G3_010 (Subpop: ancestors and descendants, 9 individuals) | 4 (F002, F003, F010, F018) | 13.53 | 13.11 | 12.55 | 11.97 | ≥ 19.7 |

Keeping every color ΔE 10 from the remainder gray cost some separation:
before that rule the same cases measured 4.16 and 13.90 at their worst.

## 3. Markers inside the box (optional)

Two optional columns beside the bars, each aligned with the bars:

- **Most probable allele** (right of the bars), for the view's selected
  markers: for homologue *h* at a marker that is an IBD position,
  P(allele *a*) = Σ<sub>*j*</sub> *p<sub>hj</sub>* · [FOUNDERALLELES<sub>*j*</sub>
  = *a*]. The allele with the largest probability is shown, in **bold** when
  P ≥ the "certain" threshold (default 0.95), normal when ≥ the "likely"
  threshold (default 0.75), *italic* below. Both thresholds are adjustable in
  the settings. Founder alleles whose entry is `-`
  contribute to "unknown"; when unknown is the largest, `?` is shown. A marker
  that is not an IBD position shows `–`, since no value is interpolated.
- **Observed genotype** (left of the bars): the two alleles as written, each
  in the color of the row's code (the code palette of the details panel and
  the "Genotype code at marker" coloring). Code meanings appear on hover only
  for files whose caption has `FACTOR0`; otherwise the hover says "Color
  code N", as the details panel does.

Each marker's text sits at the marker's position on the bar scale. When texts
would overlap, they are pushed apart to a minimum row height and a thin
leader joins each to its true position; the box grows in height if the pushed
rows need it. Markers are listed in map order (the UI model's "sort by
position"); sorting by name is a later option.

## 4. View settings

The reserved fields are used, and a few are added:

```ts
cellContents:     "name" | "name+markers" | "name+ibd" | "name+ibd+markers";
ibdLinkageGroup:  string | null;      // null: first group with IBD positions
selectedMarkers:  string[];           // on the view's group; empty: none
haplotype: {
  colorScheme:   "founder" | "allele" | "highlight";
  highlighted:   number[];            // founder alleles, at most 8
  markerColumns: { mostProbable: boolean; observed: boolean };
  thresholds:    { certain: number; likely: number };     // 0.95, 0.75
  barWidth:      number;              // px per bar, default 10; sets the merge threshold (§1.1)
  barHeight:     number;              // px, default 90
  markerTicks:   boolean;             // ticks at markers; default true
}                                     // (ticks at IBD positions always shown)
```

Settings are per view (they move with the view when tabs land). A stored group
or marker that the loaded file does not have falls back to the default. The
settings appear in a new "Haplotypes" section of the ⚙ menu; the linkage group
selector also appears in the toolbar while IBD is shown.

## 5. Rendering

### 5.1 One geometry, two renderers

A pure function computes everything inside a box:

```ts
haplotypeBox(input: { name, fill, theme, rows, markers, settings, palette })
  -> { width, height, items: (Rect | Text | Line)[] }
```

Its items are drawn by the canvas renderer (vis-network custom shape) and
written by the SVG export, so the two match by construction. A test runs both
on the same input and compares the canvas drawing calls (recorded by the jsdom
stand-in canvas) with the SVG elements.

### 5.2 On the canvas

- In IBD mode every individual is drawn with `shape: "custom"` and a
  `ctxRenderer` returning `drawNode()` and `nodeDimensions: {width, height}`
  from `haplotypeBox`. vis-network then knows each box's real size, and
  `getBoundingBox` returns it. The existing label-width estimate in
  `geometry()` is not needed for these nodes.
- **Both styles draw rectangles whenever the haplotype display is on.**
  Classic: as today, name on top, with the trait color (or the pale default)
  as the box fill. Modern: a rectangle in the Modern colors, and Modern keeps
  its curved links. The Modern shapes that encode the cross type (diamond,
  square, triangle, …) are not used in this mode, and no cross-type glyph
  replaces them; the cross type stays in the tooltip and the details panel.
- **Spacing.** Boxes vary in size (name length, marker columns). vis-network
  spaces nodes by a single `nodeSpacing` and `levelSeparation`, so both are
  computed from the largest box: across the layout direction, the largest
  extent plus 40 px; along it, the largest extent plus room for the link bands.
  The current label-based spacing becomes the special case of a name-only box.
- **Routing invariant.** Routes are computed from the boxes vis-network
  reports, so links stay clear of the larger boxes. `linkRouting.test.tsx`
  gains IBD-mode configurations (both styles, both orientations, cross
  symbols on and off) for Example.dat, `binko_ibd.ped` and the FlexQTL
  fixture, also after dragging. `e2e/linkRouting.spec.ts` gains the same
  settings for the exported SVG in WebKit; its box check already takes each
  `g.node`'s bounding box, which then includes the bars.
- **Drawing order.** Links, then boxes (vis-network draws nodes over the
  `beforeDrawing` routes), so a box always covers anything under it.

### 5.3 Redraw cost

Each frame draws every visible box. Rectangles of one color are batched into
one path across all boxes (one `fill()` per founder allele in view), and boxes
outside the viewport are skipped. If the budgets of §8 are not met, each box's
drawing is cached as an `ImageBitmap` per zoom step and invalidated by a change
of data, scheme, group, selection or size.

## 6. Label contrast and spelling

- The name takes black or white by the box fill (`labelColorOn`, ≥ 4.5:1),
  as today. No text is drawn over the bars.
- Marker text is drawn on the box fill and takes its color the same way. The
  code colors of observed alleles are used for a small swatch beside the
  text, not for the text itself, so the text stays at ≥ 4.5:1.
- Legend text is in the page's text color; swatch borders keep light colors
  visible on white.
- `labelContrast.test.ts` gains the box fills and marker text of IBD mode, and
  every new string is covered by `spelling.test.ts` (American English).

## 7. Export

- SVG, PDF and PNG write each box from `haplotypeBox`, so the export is exactly
  the screen: bands, segments, merged remainders, ticks, marker columns.
  PDF goes through svg2pdf as today; PNG through the SVG.
- **Founder-allele legend** below a top-to-bottom chart and at the right of a
  left-to-right one, after the legend of the active coloring; the page grows
  so it never covers the chart. Titled "Founder alleles, linkage group 1
  (below 0.10 merged)", the value being the merge threshold of §1.1, so it
  follows the bar width. Below its rows, "Below 0.10, merged" (the remainder
  gray) and "No IBD data" (hatched) when the image has them. It lists only the
  founder alleles shown (§2.2):
  - by founder: one row per founder, its name and two swatches labeled with
    the allele numbers;
  - by founder allele: one row per founder allele;
  - highlight: the highlighted alleles, then "Other founder alleles".

  At the right, more than 20 rows flow into columns; below, rows flow into as
  many columns as the chart's width holds. For a subset without founder names, rows
  are labeled by number.
- Tests: the SVG has one `rect` per drawn segment, the same as the canvas
  recorded; a PDF keeps the colors (`/DeviceRGB` fills of each legend color);
  the WebKit test's crossing check runs on IBD-mode exports.

## 8. Performance

**Inputs.** The FlexQTL fixture (74 individuals, 29 founders, 58 founder
alleles, 2 groups, 21 positions each), and a synthetic pedigree of 300
individuals with 50 IBD positions on one group. The synthetic file is written
by a generator in `backend/tests/` (30 founders; offspring inherit parental
homologue segments with random crossovers; probabilities blurred around the
true founder allele), not committed as data.

**Measured.** Layout time (from `new Network` to the first frame) and redraw
time (the drawing of one frame, wrapped in `performance.mark`/`measure`, which
the WebKit test reads with `performance.getEntriesByName`), each in name-only
and IBD mode, in WebKit on macOS. Payload size of `/api/haplotypes`.

**Baseline** (PR 1, name-only display, WebKit on macOS, three runs):

| | FlexQTL fixture | Synthetic 300 × 50 |
|---|---|---|
| Layout | 25–26 ms | 63–64 ms |
| Redraw, median (largest) | 1 ms (4 ms) | 2 ms (3 ms) |

WebKit reports times in whole milliseconds.

**Budgets** (macOS, WebKit):

| | FlexQTL fixture | Synthetic 300 × 50 |
|---|---|---|
| Layout, IBD mode vs name-only | ≤ +10 % | ≤ +10 % |
| First frame with bars | ≤ 100 ms | ≤ 300 ms |
| Redraw (pan/zoom frame) | ≤ 16 ms | ≤ 33 ms |
| `/api/haplotypes` for one group | ≤ 100 kB | ≤ 1 MB |

CI runs the same measurement with generous limits (5× the budgets) so that
regressions fail without making CI flaky; the macOS numbers are recorded in
the PR.

## 9. Interaction

- Hovering a band shows a tooltip, in the color scheme's terms: "LG 1, 0.000 cM · homologue from Parent 1
  · founder allele 23 (F003) · 0.95", and for a merged remainder, the founder
  alleles it holds with their probabilities.
- Hit-testing: the pointer (`network.DOMtoCanvas`) is located in the box under
  it (from the geometry already kept for routing), then in a bar, band and
  segment from `haplotypeBox`'s items. vis-network's own tooltip (the name and
  parents) still shows over the name row; over the bars the band tooltip
  replaces it.
- In the highlight scheme, clicking a legend entry or a segment toggles that
  founder allele's highlight (at most 8).
- Selection, dragging (within the row) and fit to window are unchanged.

## 10. First step and pull requests

The **smallest first step** is PR 1: data and geometry with no visible change,
fully tested, so the visible PRs build on settled numbers.

1. **Haplotype data and geometry** (no visible change).
   `/api/haplotypes`; `/api/pedigree` without `ibd`; `lib/haplotype.ts`
   (bands, segments, narrow-segment merging, `haplotypeBox`); the palettes
   with the ΔE and color-blind tests of §2.3; the synthetic generator; the
   `performance.mark` hooks and the baseline measurements.
2. **IBD bars on the chart** (default scheme). Custom-shape boxes in both
   styles, spacing from box sizes, the group selector, band hover; routing
   invariant in jsdom and WebKit for both styles and orientations; performance
   measured against the budgets. Draft PR, tested on macOS. The SVG export
   already writes the boxes item for item (the WebKit routing check reads the
   exported SVG, so it needs them); while the bars' data loads, the chart
   waits instead of laying out a name-only chart first.
3. **Export** of IBD mode: the founder-allele legend, and the PDF and PNG
   checks, with their WebKit test.
4. **Color schemes and settings**: by founder allele, highlight (with legend
   clicks), the "Haplotypes" ⚙ section and per-view persistence.
5. **Markers in the box**: most probable allele with thresholds, observed
   genotypes with code swatches, label placement.

Each PR updates the CHANGELOG's [Unreleased] section and, where it changes the
interface, the WebKit tests.

## 11. Decisions (review of 2026-11-20)

1. **Bands:** midpoints between positions, plus a tick at each actual IBD
   position (§1.1).
2. **Segment order:** by founder-allele number (§1.1).
3. **Shapes:** rectangles in both styles whenever the haplotype display is on;
   Modern keeps its colors and curved links; no cross-type glyph (§5.2).
4. **Thresholds:** 0.95 and 0.75 by default, adjustable in the settings (§3).
5. **`/api/pedigree`** drops `ibd`; the API is internal since 2.2.2 (§1.2).
6. **Palette** over the contributing founders only, which the legend lists
   exactly (§2.2).
