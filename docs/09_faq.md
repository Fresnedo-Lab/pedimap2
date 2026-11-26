# Chapter 9 — Questions and answers

## Installing and starting

**macOS says Pedimap 2 cannot be opened or verified.**
Right-click the app in Applications and choose **Open**. On macOS 15
(Sequoia) and later, open **System Settings → Privacy & Security** and click
**Open Anyway** ([Chapter 2](02_installation.md)).

**The AppImage does not start on Linux.**
Mark it as executable first: `chmod +x Pedimap2-*-Linux-x86_64.AppImage`.

**The window says "Cannot reach the Pedimap backend service".**
Pedimap's calculation service stopped, could not start, or did not answer
within a minute. Click **Retry**. If that does
not help, quit Pedimap and open it again. If the message stays, report it
with the version number (**About**, at the top right of the window).

**How do I update?**
Pedimap offers each new version when it starts; click **Install and
restart**. You can also click **About → Check for updates**.

## Opening files

**My file does not open, and Pedimap shows "Parse error: Line …".**
Open the file in a text editor, go to that line and correct it.
[Chapter 4](04_file_formats.md) lists the common errors and their causes.

**An individual appears as a founder, but it has parents.**
Its name in a parent column may be spelled differently from its own line
(names are case-sensitive). Pedimap warns about every parent without a line
of its own, and suggests the closest existing name.

**Pedimap shows my 1–9 scores as categories, not as a scale.**
A trait whose values are all single characters is taken as a set of
categories. To have it treated as a measurement, write the values with more
than one character, for example `1.0` to `9.0`.

**I selected a .pmp file and nothing opened.**
Select the `.pmp` file together with its `.dat` file. Pedimap 2 reads only
the population name from the `.pmp` file so far.

**Can I open a pedigree saved by Pedimap 1.x?**
Yes: Pedimap 2 opens Pedimap 1.x `.dat` files as they are, including those
saved in older Windows text encodings.

## The chart

**The pedigree is listed instead of drawn.**
It has more individuals than the drawing limit (1,000 by default). Build a
subpopulation around an individual, or raise the limit under **Settings**
([Chapter 8](08_advanced.md)).

**The arrow keys and + and – do nothing.**
Click the chart first; the keys then move and zoom it. While you type in the
search box, they type.

**A line looks as if it crosses a box.**
Lines never pass through a box they do not connect; a line that seems to may
run just past it. Zoom in to see.

**Can I change a name or a value in Pedimap?**
Not yet: Pedimap shows your data but does not edit it. Correct the data file
and open it again.

## IBD bars

**There is no IBD bars menu.**
The file has no IBD probabilities. Files from FlexQTL and Binko.jl have them
when the analysis wrote IBD sections; a Pedimap `.dat` file needs `NALLELES`
and `IBDPOSITION` sections ([Chapter 4](04_file_formats.md)).

**Some linkage groups are missing from the IBD bars menu.**
Only linkage groups with IBD positions are offered.

**Much of a bar is dark gray.**
Those are probabilities too small to draw separately, merged into one
segment. Widen the bars under **Settings → IBD bars**
([Chapter 6](06_visualization.md)).

**Two founders have colors I cannot tell apart.**
Hold the mouse over the segment to see its founder allele, switch the palette
to **By founder allele**, or show a subpopulation, which has fewer founders.

**The colors of a founder changed.**
Colors are shared out over the founders of the individuals shown, so they
change when you show a subpopulation or open another file. The legend at the
lower left of the chart always gives the colors shown, and an exported
image's legend those of that image.

## Exporting

**The Export image button is grayed out.**
The pedigree is above the drawing limit. Build a subpopulation first, or
raise the limit.

**The PNG is less sharp than I expected.**
Very large charts are saved at a lower resolution, to stay within 16,000
pixels per side. Save an SVG or PDF instead.

**Can I save a JSON file?**
Yes: **Save as JSON** saves the whole population with all of its data. For a
subpopulation, use **Export subpopulation (.dat)** ([Chapter 7](07_data_export.md)).

## Appendix A: Pedimap 2 and the original Pedimap

Pedimap 2 opens Pedimap 1.x data files. It draws the pedigree with trait
colors and IBD probabilities and shows the marker data, in a classic display
style like Pedimap 1.x's and a modern one. Several features of Pedimap 1.x are not
available yet:

| Pedimap 1.x | Pedimap 2.5 |
|------------------------------------------|-----------------------------------|
| Several **views** of a population, each with its own options | One view. Its settings are remembered. |
| A **population panel** with a tree of named subpopulations, which can be combined | One subpopulation at a time: an individual's ancestors and descendants |
| **Selecting relatives** by maternal or paternal line, up to a number of generations | All ancestors and descendants only |
| An **information panel** that follows the mouse | A hover box, and the details panel on a click |
| **Marker scores** and **most probable alleles** inside the boxes | Shown in the details panel, not yet in the boxes |
| **IBD probabilities** inside the boxes | **IBD bars**, with two palettes and an adjustable width |
| An **on-screen legend** of the IBD colors | On screen at the lower left of the chart (it can be collapsed), and in exported images |
| **IBD probabilities for polyploids** | Diploids only; a file with IBD data and another ploidy is refused |
| A sortable **table of individuals** with their data | A list of names with a search box, and the details panel |
| Adjustable **spacing** between generations and individuals | Not adjustable yet |
| **Projects** (`.pmp`) saved and opened | `.pmp` opened for the population name only; not saved |
| The FlexQTL tools **Add semifounder parents** and **Impute missing founder alleles** | Not available |
| **Export to FlexQTL's input format**, with semifounder handling | Not available |
| Printing | Save a PDF and print it |
| Windows only | macOS, Windows and Linux |

What Pedimap 2 adds: the Modern display style, lines routed so that they
never pass through a box, image export as PNG, SVG and PDF with legends, the
reading of FlexQTL and Binko.jl files as their specification describes, IBD
bars with color-blind-aware palettes, coloring by marker, saving a whole
population with all of its data as JSON, and automatic updates.

## Appendix B: FlexQTL genotype codes

In the files of FlexQTL and Binko.jl, each allele of a genotype is followed
by a code that says how the genotype was obtained when FlexQTL checked the
marker data against the pedigree. Pedimap shows these codes as colored
badges and colors, and gives their meaning for FlexQTL and Binko files.

The code numbers and short names are FlexQTL's: its consistency classes, and
the labels it writes into the file. The meanings below are worded for this
manual, following the [reader
specification](reference/flexqtl-binko-pedimap/pedimap-input-file-reader-spec.md)
(section 4.2).

| Code | Short name | Meaning |
|---|-----|-------------------------------------------|
| 0 | OC | Observed, and consistent with the pedigree |
| 1 | MA | Missing in the data and filled in from the relatives' genotypes |
| 2 | OEA | Observed, judged an error, removed and filled in again |
| 3 | pnuA | Involves a putative null allele; the genotype was completed |
| 4 | pnuM | Involves a putative null allele; the genotype was left missing |
| 5 | IM | Incomplete or missing in the data, and not filled in |
| 6 | OpE | Observed and flagged as a possible error, but kept |
| 7 | OE | Observed, judged an error and removed; the raw alleles are shown |
| 8 | pnuE | Involves a putative null allele and is in error |
| 9 | ME | Labeled "missing and error" by FlexQTL |
| 11 | OPhE | Observed and consistent (code 0, 2 or 6), but the analysis gave no most probable phase |
| 12 | MAPhE | Filled in (code 1), but the analysis gave no most probable phase |

Pedimap shows these meanings only for files whose pedigree has a `FACTOR0`
column, as FlexQTL and Binko files do. In other files the codes are color
codes without a fixed meaning.

## Appendix C: Glossary

**Allele copies** — how many copies of a given allele an individual carries
at a marker: 0, 1 or 2 in a diploid.

**Band** — the stretch of an IBD bar colored by the probabilities at one IBD
position.

**cM (centimorgan)** — the unit of map distance on a linkage group: over a
short distance, 1 cM corresponds to about 1% recombination between two loci.

**Continuous trait** — a trait with measured values (`105`, `7.4`).

**Cross symbol (×)** — the point where the lines from two parents meet, with
one line on to their offspring; full sibs share one.

**Discrete trait** — a trait with categories (`red`, `white`; or scores of a
single character, such as 1 to 9).

**Drawing limit** — the number of individuals above which Pedimap lists the
pedigree instead of drawing it.

**Dummy founder** — a founder without data that Binko.jl adds for an unknown
parent, named for example `DUMMY_G1_007_F`.

**FACTOR0** — a column in FlexQTL and Binko files giving each individual's
place in the pedigree: 0 founder, 1 with offspring, 2 without.

**Founder** — an individual whose parents are both unknown. Founders are
assumed to be unrelated, so each founder's alleles count as distinct founder
alleles, even where two of them are the same marker allele.

**Founder allele** — one of the founders' alleles, numbered across all
founders: founder 1 has founder alleles 1 and 2, founder 2 has 3 and 4, and so
on. IBD probabilities say which founder allele a chromosome segment descends
from.

**Full sibs** — individuals with the same two parents.

**Generation** — 0 for founders; otherwise one more than the higher of the
parents' generations.

**Genotype code** — the number after each allele of a genotype in the data
file. In FlexQTL and Binko files it says how the genotype was obtained
(Appendix B); otherwise it is a color code.

**Haplotype** — the combination of alleles along one homologue. An IBD bar
shows a homologue's haplotype in terms of founder alleles.

**Homologue** — one of an individual's two copies of a chromosome (linkage
group), one from each parent.

**IBD (identity by descent)** — two alleles are identical by descent when they
are copies of the same ancestral allele. Pedimap's IBD probabilities give, for
each position and homologue, the probability that the homologue's allele there
is a copy of each founder allele.

**IBD bar** — the drawing of one homologue's IBD probabilities along a
linkage group, inside an individual's box.

**IBD position** — a position on a linkage group at which the file gives IBD
probabilities.

**Identical by state (IBS)** — alleles that are the same marker allele,
whether or not they are copies of the same ancestral allele. In the example
pedigree, GoldenD's founder allele 1 and IngridM's founder allele 3 are both
SSR1 allele 180: identical by state, but distinct founder alleles.

**Linkage group** — a group of markers on one chromosome, with their map
positions.

**Merge threshold** — the probability below which Pedimap draws a founder
allele's segment as part of the gray remainder: 1 divided by the bar width in
pixels.

**Palette** — the set of colors for founder alleles: **By founder** or **By
founder allele**.

**Recombination (crossover)** — the exchange of segments between the two
homologues of a parent during meiosis, so that the homologue it passes on
combines pieces of both. Along an IBD bar, a clear change from one founder
allele to another marks a recombination in the line of descent; a band whose
proportions only shift from the band before means that a recombination may
have occurred in that interval, which the analysis cannot place with
certainty.

**Semifounder** — an individual with one known and one unknown parent. For an
IBD analysis, the unknown parent is usually stood in for by a founder without
data, such as Binko.jl's dummy founders.

**Single-parent descent** — an individual from one parent: selfing (`*SELF`),
a doubled haploid (`*DH`), a mutant (`*MUT`) or vegetative propagation
(`*VP`).

**Subpopulation** — part of a pedigree shown on its own; in Pedimap 2, an
individual with all its ancestors and descendants.
