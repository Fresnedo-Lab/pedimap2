# Chapter 4 — File formats

This chapter describes the files Pedimap 2 opens, what to put in them, and
what to do when Pedimap reports a problem with one. It is written for people
who prepare data; the complete rules, for software that writes these files,
are in the [`.dat` format reference](reference/dat-format.md) and the
[FlexQTL and Binko.jl reader specification](reference/flexqtl-binko-pedimap/README.md).

## Files Pedimap opens

Click **Open File** in the toolbar and choose one of these:

| File | What it is |
|---|---|
| `.dat` | A Pedimap data file: the pedigree, traits, and optionally markers and IBD probabilities. The format of Pedimap 1.x. |
| `.ped` | The `pedimap.ped` file that FlexQTL and Binko.jl write: a `.dat` file with a few additions (see below). |
| `.dat` with its `.pmp` | A Pedimap 1.x project. Select both files together in the Open dialog. |
| `.json` | A pedigree in Pedimap 2's own format. |

Opening a file replaces the pedigree shown. Pedimap never changes the files
you open; to save the pedigree, export it (see [Chapter 7](07_data_export.md)).

## Pedimap data files (.dat)

A `.dat` file is plain text. You can write one in any text editor, or save it
from a spreadsheet as tab-separated text. Columns are separated by spaces or
tabs, so they need not line up. A semicolon (`;`) starts a comment, which
runs to the end of the line.

A small file looks like this:

```
POPULATION = My crosses      ; the name shown in the window
UNKNOWN    = -               ; marks an unknown parent or a missing value

PEDIGREE
NAME      FEMALE    MALE      Height   Flower
ParentA   -         -         112      white
ParentB   -         -         98       red
Line1     ParentA   ParentB   105      pink
Line2     Line1     *SELF     101      pink
```

### Header lines

Header lines come first, each as `KEYWORD = value`. All are optional.

| Keyword | Default | Meaning |
|---|---|---|
| `POPULATION` | the file name | The pedigree's name, shown in the window and in exported file names |
| `UNKNOWN` | `-` | The symbol for an unknown parent or a missing value. Several symbols may be listed; any of them counts. |
| `PLOIDY` | `2` | The ploidy of the population |
| `NALLELES` | `0` | The number of founder alleles per locus; needed for IBD probabilities (see below) |
| `NULLHOMOZ` | `$` | The symbol for a homozygous null marker allele |

### The pedigree table

The table starts with a line that says `PEDIGREE`. The next line names the
columns:

- **`NAME`**, then **two parent columns**, named `FEMALE` and `MALE`, or
  `MOTHER` and `FATHER` (in either order), or `PARENT1` and `PARENT2`;
- then one column per **trait**, with the trait's name.

Each further line is one individual: its name, its two parents, and its trait
values. Every line must have as many fields as the column line; write the
`UNKNOWN` symbol for a value you do not have.

- **Founders** have both parents unknown.
- **Order does not matter.** An individual may come before its parents.
- **Names are case-sensitive** and must be spelled the same everywhere:
  `Elstar` and `elstar` are two different individuals.
- **Names with spaces** must be written in double quotes, in every place they
  appear: `"Golden Delicious"`.
- **One parent only:** write the parent in the first parent column and, in
  the second, how the individual came from it: `*SELF` (selfing), `*DH`
  (doubled haploid), `*MUT` (mutant) or `*VP` (vegetative propagation, a
  clone). Naming the same parent in both columns also means selfing.
- **A parent without a line of its own** is taken as a founder without data.
  Pedimap warns about it, because it is often a misspelled name (see
  "When a file has a problem" below).

### Traits

Pedimap decides for each trait column whether it is **discrete** (categories)
or **continuous** (a measurement):

- discrete, if every value is a single character (`1` to `9`, `A`, `B`), or if
  any value is not a number (`white`, `red`, `AB`);
- continuous otherwise: numbers such as `112`, `-2` or `7.4`.

So a score from 1 to 9 is a category, and heights from 98 to 112 are a
measurement. A discrete trait whose values are color names (`Red`, `Green`,
`Yellow`) is drawn in those colors.

### Markers and IBD probabilities

After the pedigree, a file may describe linkage groups and the data of each
individual on them:

- a `LINKAGEGROUP` section for each group, with its map (`MAP`: each locus
  and its position in cM), each locus (`LOCUS`, with `ALLELENAMES`, and
  `FOUNDERALLELES` for IBD), and the positions with IBD probabilities
  (`IBDPOSITIONS`);
- for each locus, an `ALLELES` section: each individual's two alleles, each
  followed by a genotype code (a number that Pedimap can show as a color);
- for each IBD position, an `IBDPOSITION` section: for each individual and
  each of its two chromosome copies, the probability of descending from each
  founder allele.

`NALLELES` must then be the number of founder alleles: two per founder in a
diploid population. IBD probabilities are supported for diploids only.

Files with markers or IBD probabilities are usually written by software, such
as FlexQTL or Binko.jl, not by hand. The [format
reference](reference/dat-format.md) gives every rule, with the example
pedigree worked through.

## FlexQTL and Binko.jl output

FlexQTL and Binko.jl write a file named `pedimap.ped` for Pedimap. Open it
with **Open File** like any other file. Pedimap reads it as the [reader
specification](reference/flexqtl-binko-pedimap/README.md) describes:

- **all linkage groups** with their IBD probabilities, each section under
  its own linkage group;
- the **genotype codes**, with the meaning FlexQTL gives them
  ([Appendix B](09_faq.md#appendix-b-flexqtl-genotype-codes)), shown when
  you hold the mouse over a code;
- the **`FACTOR0`** column, which gives each individual's place in the
  pedigree (0 a founder, 1 with offspring, 2 without). It is not a trait, so
  it is not offered for coloring; Pedimap warns if a value disagrees with the
  pedigree;
- **dummy founders**: when a parent is unknown, Binko.jl puts in a founder
  without data, named for example `DUMMY_G1_007_F`. Its founder alleles
  still appear in its descendants, so Pedimap draws it with its own two
  alleles, as every founder.

> **If you opened a FlexQTL file with more than one linkage group in
> Pedimap 2.2.2 or earlier, open the original file again.** Those versions
> mixed up the IBD probabilities of such files; `.dat` files saved from them
> carry the mixed-up data.

## JSON files (.json)

A `.json` file holds a pedigree in Pedimap 2's own format, with all of its
data. Pedimap opens such files, but cannot yet save one: to keep a pedigree,
export it as a `.dat` file ([Chapter 7](07_data_export.md)).

## Project files (.pmp)

A `.pmp` file is a Pedimap 1.x project: it refers to a `.dat` file and stores
subpopulations, views and their settings. Select the `.pmp` file together
with its `.dat` file in the Open dialog. Pedimap 2 currently reads only the
population name from it; subpopulations and saved views are not read yet.

## Accented names and older files

Pedimap reads files in UTF-8, the usual text encoding today. Older files,
saved by Windows programs in the Windows-1252 encoding, are recognized and
read correctly; Pedimap then shows a note saying so. Files that Pedimap saves
are always UTF-8.

## When a file has a problem

**Errors.** If a file breaks a rule, Pedimap does not open it and shows a
message above the chart that starts with the line number, for example:

> Parse error: Line 12: the pedigree row of 'Line7' has 6 fields, but the
> caption has 5.

Open the file in a text editor, go to that line and correct it. The pedigree
shown before stays as it was.

**Warnings.** Problems that do not make the data wrong are shown as
warnings, in an amber bar above the chart, and the file opens. Click
**Dismiss** to close the bar. Read them: they often point to a mistake.

| Message begins with | What it usually means |
|---|---|
| "1 parent(s) have no row of their own: 'Elstr' (closest existing individual: 'Elstar')" | A misspelled parent name. Correct the spelling in the parent column. |
| "FACTOR0 does not match the pedigree…" | The FACTOR0 column of a FlexQTL or Binko file disagrees with the parents listed. The column is kept as read. |
| "… IBD homologue(s) do not sum to 1 within the rounding of their values…" | Some IBD probabilities add up to more or less than 1. They are drawn scaled to 1 and shown as read. |

Common errors and their causes:

| Error | Likely cause |
|---|---|
| "…has 6 fields, but the caption has 5" | A missing or extra value on that line, or a name with a space that is not in quotes |
| "Duplicate individual name: …" | The same individual on two lines |
| "Circular pedigree — the following individuals form an ancestry cycle: …" | An individual listed as its own ancestor, usually from a swapped name |
| "Unrecognized parent columns…" | The parent columns are not named FEMALE/MALE, MOTHER/FATHER or PARENT1/PARENT2 |
| "Please select a .dat, .ped or .json file." | Only a `.pmp` file was selected; select its `.dat` file too |
