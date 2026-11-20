# Pedimap input file: reader's specification and test fixtures

This directory holds a specification, written for someone implementing a reader, of the input file of the
pedigree-visualization program Pedimap **as two programs write it**: FlexQTL 0.99130 and Binko.jl (a Julia
reimplementation of FlexQTL's method). It also holds three small test files (fixtures), each with its expected parsed
content as JSON, and the script that regenerates them.

It describes what FlexQTL 0.99130 and Binko write, as observed in their files and as Binko's writers define it. It is
**not** Pedimap's own format documentation, and it makes no statement about how Pedimap reads a file.

It was prepared for the Pedimap 2 project (github.com/Fresnedo-Lab/pedimap2). This is its second version, of
2026-11-19, after the project lead's first review (the changes are listed at the end).

## Contents

| File | What it is |
|---|---|
| `pedimap-input-file-reader-spec.md` | The specification: lexical rules, the legacy layout section by section, the indicator codes, the IBD sections, every difference between FlexQTL's and Binko's files, what a reader should tolerate and reject, open points. |
| `make_fixtures.jl` | The Julia script that regenerates the two Binko fixtures, the FlexQTL fixture and the three expected JSON files, and checks all of them. It contains a small reference reader (`read_pedimap`). |
| `fixtures/binko_legacy.ped` | A Pedimap file without IBD parts, written by Binko's legacy writer (`Binko.Markers.write_pedimap`) on the simulated set `pm_small`. 415 lines. |
| `fixtures/binko_ibd.ped` | A Pedimap file with IBD parts, written by Binko's IBD writer (`Binko.IBD.write_pedimap_ibd`) on the same set. 520 lines. |
| `fixtures/flexqtl_routeB_sim_small.ped` | A Pedimap file with IBD parts written by FlexQTL 0.99130 from simulated data: the file `test/data/sim/flexqtl/sim_small_ibd/pedimap.ped.gz` of the Binko repository, decompressed, **with the three contact lines of its head replaced by one placeholder comment line** (below). 6,980 lines, 2.1 MB. |
| `fixtures/<name>.expected.json` | The expected parsed content of each of the three files (layout below). |
| `fixtures/input/pm_small.dat`, `pm_small.map` | The simulated data set behind the two Binko fixtures, in FlexQTL's input layout (data file and map file), as `Binko.Simulate` wrote it. For reference; a reader of Pedimap files does not need them. |

"Route B" is the name the Binko project uses for FlexQTL's fixed-position run (`indicQTL 2` in FlexQTL's parameter
file), the run that computes identity-by-descent (IBD) probabilities on founder alleles and writes them into the
Pedimap file. The "legacy layout" is the file of an ordinary QTL run, which has no IBD parts.

## How the fixtures were made

One command, run from the directory that contains `pedimap2-reader-spec`:

```
julia +1.11.9 --project=<path to a Binko.jl checkout> pedimap2-reader-spec/make_fixtures.jl
```

`--project` names a checkout of Binko.jl: version 0.1.0 with the writers of commit `955aefa` (2026-11-19), its
committed `Manifest.toml`, Julia 1.11.9. The checkout stood at commit `a8d088d` for the last run; the two commits
after `955aefa` change documents only and no file under `src/`. The script writes only into
`pedimap2-reader-spec/fixtures/` and a temporary directory. It takes about two minutes on one thread. Consecutive
runs gave byte-identical files (SHA-256 below); the time stamp line of the two Binko files is a fixed text for that
reason.

Commit `955aefa` changed Binko's Pedimap writers in three ways, all of which the two Binko fixtures show: the pedigree
table has a row for each dummy founder (the founder without data that Binko creates for the unknown parent of an
individual with one known parent); the `;founders` comment row of an IBD section separates its names by single
blanks; and the note on `FACTOR0` and the code legend are comment lines in Binko's own words. Files written by Binko
before that commit name a dummy founder in a parent column without a row for it. The specification marks each rule
that depends on this.

What the script does, in order:

1. **Simulates the set `pm_small`** with `Binko.Simulate` from fixed seeds: a pedigree of 6 founders and two
   generations of 3 full-sib families of 3 (`random_pedigree`, seed 24, probability 0.12 of a single known parent: the
   seed was chosen because it gives one individual with only its second parent known and one with only its first), 24
   individuals in all; 3 linkage groups with 4, 4 and 3 markers (biallelic with letter names on groups 1 and 2; three
   or four alleles with integer names on group 3); a two-level factor `Block` and one trait `y`; 8 percent missing
   genotypes, 2 percent allele errors, 10 percent missing trait values (`simulate`, seed 20261119). The data and map
   files are written with `Simulate.write_flexqtl` and read back with Binko's readers, as a run would read them.
   Binko adds the two dummy founders, `DUMMY_G1_007_F` and `DUMMY_G2_004_M`: 26 individuals in its pedigree.
2. **Writes `binko_legacy.ped`**: Binko's consistency pass (`Markers.consistency_pass`, `consistency_codes`) gives the
   consistency classes; a short chain of Binko's descent sampler on the edited data (`Descent.DescentState`, 2,000
   sweeps after 200 of burn-in, seeds 11 and 12) gives the most probable phases (`Descent.locked_phases`);
   `Markers.pedimap_codes` and `pedimap_alleles` turn the two into indicator codes and allele tokens, and
   `Markers.write_pedimap` writes the file. This is the sequence of calls of Binko's own test of the legacy writer,
   with Binko's phases and classes in place of FlexQTL's.
3. **Writes `binko_ibd.ped`** by the steps of `Binko.run_ibd`: `IBD.parse_fixqtlpos` on the positions `100.05`,
   `100.20` and `300.30` (FlexQTL's form chromosome × 100 + Morgan: 5 cM and 20 cM on group 1, 30 cM on group 3, none
   on group 2), `IBD.run_ibd_chains` (2 chains, 1,000 sweeps after 100 of burn-in, seed 20261119, `anchorMarker` 0),
   `IBD.posterior_pedimap_alleles`, `IBD.write_pedimap_ibd`. `run_ibd` itself is not called because it stamps the file
   with the clock's time and does not return the allele and code matrices the expected JSON is built from; the writer
   and its inputs are the same.
4. **Builds the expected JSON of the two Binko files from the data the writers were given** (the pedigree, the data
   set, the map, the allele and code matrices, the IBD result), not from the files: a pedigree row for each of the 26
   individuals, and genotype and IBD rows for the 24 that are not dummy founders.
5. **Makes the FlexQTL fixture**: decompresses `test/data/sim/flexqtl/sim_small_ibd/pedimap.ped.gz`, checks its
   SHA-256 against the line of `pedimap.ped` in the run's `MANIFEST.sha256`, replaces the three contact lines of the
   head by the placeholder line, checks that every other line is unchanged, and writes the result.
6. **Builds the expected JSON of the FlexQTL file with the script's own reader**, since no in-memory source exists, and
   cross-checks it twice: the IBD parts against `Binko.IBD.read_pedimap_ibd` (NALLELES, 42 positions, 42
   `FOUNDERALLELES` lines, 3,108 probability rows: all equal), and the pedigree, factor, trait, map and genotypes
   against the simulated input files of that run, `test/data/sim/sim_small/sim_small_fq.dat` and `sim_small.map` (74
   individuals with their parents and values, 42 markers with their positions, and the 2,717 genotype rows of code 0,
   each holding the data file's two alleles).
7. **Counts the observations** the specification reports for the IBD files (founder order, homologue order, anchoring
   of the founder alleles, what is written for a founder without data, sums), on the Binko IBD fixture, on the FlexQTL
   fixture, and on FlexQTL's second file from simulated data,
   `test/data/sim/flexqtl/p43_sim_deep_ibd_pos/pedimap.ped.gz` (read from the repository into a temporary directory,
   not copied here).
8. **Self-check**: reads each fixture again with `read_pedimap`, compares it with its expected JSON (read back with
   JSON3; numbers equal within 1e-9), and sums every individual's probabilities per homologue. It then reads
   `binko_ibd.ped` once more with the pedigree rows of the two dummy founders removed, which is the form Binko wrote
   before commit `955aefa`, and checks that the reader finds the two parents without a row and reads the same founder
   alleles, map, genotypes and IBD sections.

The reader `BIO.read_dat` warns that the data file's header names each marker's second column `xx_<marker>`; that is
the simulator's header and the warning is expected.

### The self-check's result (run of 2026-11-19, Binko's writers of commit `955aefa`)

```
self-check
binko_legacy.ped equals binko_legacy.expected.json: 26 individuals, 8 founders, 3 linkage groups, 11 markers, 264 genotype rows, 0 IBD positions, 0 IBD rows (15909 and 15483 bytes)
binko_ibd.ped equals binko_ibd.expected.json: 26 individuals, 8 founders, 3 linkage groups, 11 markers, 264 genotype rows, 3 IBD positions, 72 IBD rows (44105 and 33162 bytes)
  binko_ibd: 144 homologue sums, all within the tolerance (4 decimals); the largest |sum - 1| is 1.11e-16, at most 1.39e-13 of its tolerance; all within 0.05: true
flexqtl_routeB_sim_small.ped equals flexqtl_routeB_sim_small.expected.json: 74 individuals, 29 founders, 2 linkage groups, 42 markers, 3108 genotype rows, 42 IBD positions, 3108 IBD rows (2143354 and 2103819 bytes)
  flexqtl_routeB_sim_small: 6216 homologue sums, all within the tolerance (2 decimals); the largest |sum - 1| is 0.02, at most 0.667 of its tolerance; all within 0.05: true
binko_ibd.ped without the pedigree rows of its 2 dummy founders (DUMMY_G1_007_F, DUMMY_G2_004_M; the form before Binko's commit 955aefa): the parents without a row are found, and the founder alleles, the map, the genotypes and the IBD sections read the same
self-check passed
```

For the two Binko files the comparison is between two independent statements of the content (the writer's inputs and
the file as read). For the FlexQTL file the expected JSON comes from the same reader, so the comparison shows only that
the JSON round trip is exact; the independent checks of that file are the two cross-checks of step 6.

### SHA-256 of the generated files

```
e733e17cce76d027baa2871ddaac0266de22248c5d448c88e8e62cffdbad5ef9  fixtures/binko_legacy.ped
2eff7435d840d29f4b4afa2b64706699e1b513b9341aeb9dcd32e24823bdf75b  fixtures/binko_legacy.expected.json
47abdfa443b7c6560d80a07e88cf537d695eae310539aab3e55acd622c4069b2  fixtures/binko_ibd.ped
762830b9fe7e9f2e4d4ee56adcda07b7a3e88633dfa9c42ebe80602aa2af1136  fixtures/binko_ibd.expected.json
00f0645728b670bd6be370b132aa26058539ab0e8c6be095bb18b7555ab88480  fixtures/flexqtl_routeB_sim_small.ped
644f7ca8f11a70ecedbf53af271223a392179300cf22611aa2ed7db2efcd2d67  fixtures/flexqtl_routeB_sim_small.expected.json
f47a5e7b3af45b1dcf90fb46779a0bbcd301fe1722488c5fb00b4808f7b370cf  fixtures/input/pm_small.dat
65d4b41203016629312021ca2f8c5145786a1b03ab1efc3ffb61de8e15749d52  fixtures/input/pm_small.map
```

The Binko files change if Binko's sampler or writers change; the first line of both carries Binko's version.

## The FlexQTL fixture's origin, and how it differs from FlexQTL's own file

`fixtures/flexqtl_routeB_sim_small.ped` comes from the file `pedimap.ped` of the run `sim_small_ibd`: FlexQTL 0.99130,
run as a black box by the Binko project on the Ohio Supercomputer Center (host `c0316.ten.osc.edu`) on 2026-10-12,
exit status 0 after 20 min 40 s (the run's `run.log`, beside the compressed copy in the Binko repository).

- **Input data: simulated.** `sim_small` is a set generated by `Binko.Simulate` (`scripts/make_corpus.jl`, seeds
  20261007 and 20261008): 20 founders, 3 generations of 5 families of 3, 15 percent single known parents, 2 linkage
  groups of 100 cM with a marker every 5 cM, no missing genotypes and no errors. FlexQTL does not accept an individual
  with one known parent, so the data file given to it, `sim_small_fq.dat`, names a dummy founder `DUMMY_<name>_M` or
  `DUMMY_<name>_F` for each missing parent and holds that founder as a row without data (`scripts/flexqtl/make_pars.jl`).
  This is why 9 of the file's 74 individuals are called `DUMMY_…`, and why the file shows what FlexQTL writes for a
  founder without data (specification, 5.9).
- **Parameter file.** `scripts/flexqtl/pars/sim_small_ibd.par` of the Binko repository at commit `c8ddd2d`
  (SHA-256 `7cfea016…`, the value of `flexqtl.par.original` in the run's manifest; the file at the current commit
  differs from it only in the comment after the seed). Its settings for this file: `indicQTL 2`, `maximQTL 1`,
  `fixQTLpos MARKERS` (an IBD position at every marker), `anchorMarker 0`, `lockMPhase 1`, `pedimapV 1`,
  `length 50000`, `thinning 50`, `MSegAlpha 0.005`, `seed 2610113`.
- **The source file.** The Binko repository keeps FlexQTL's file gzip-compressed. Decompressed it has 2,143,369 bytes
  and the SHA-256 `44aaff323dbed6ca88749cc06d2a45656eac89173813f67f8e59dfffcbaa1659`, the value the run's manifest
  gives for `pedimap.ped`.
- **The fixture is not that file byte for byte.** By the project lead's decision of 2026-11-19, the three contact
  lines of FlexQTL's head (lines 5 to 7 of its file: a line that introduces the contacts, then one line each for the
  author of Pedimap and the author of FlexQTL, with a name and an e-mail address) are replaced by one comment line:

  ```
  ; [placeholder of pedimap2-reader-spec] FlexQTL 0.99130 writes three contact lines at this place, for Pedimap's author and its own; they are left out of this fixture
  ```

  The fixture differs from FlexQTL's own output by exactly those lines: the script checks that the other 6,979 lines
  are FlexQTL's, unchanged and in order. The fixture has 6,980 lines and 2,143,354 bytes, and its SHA-256 is
  `00f0645728b670bd6be370b132aa26058539ab0e8c6be095bb18b7555ab88480`; it no longer equals the manifest's value. The
  replaced lines are comments, so the parsed content, and with it the expected JSON, is the same as that of FlexQTL's
  own file.

The file is larger than a comfortable fixture (2.1 MB, lines of 611 characters, and an expected JSON of 2.1 MB). It is
kept whole because it is the only FlexQTL route B file from simulated data of that size: FlexQTL's other one in the
repository (`p43_sim_deep_ibd_pos`: 212 individuals, 102 markers, one IBD position, 0.9 MB) has a single position.

The fixture still holds, as comment lines, FlexQTL's own note on `FACTOR0`, its legend of the indicator codes and its
column guides: they are what a parser meets, and the specification does not reproduce the note or the legend. The two
Binko fixtures hold Binko's own note and legend, which the specification quotes.

## Layout of the expected JSON

One object per fixture; `null` stands for the unknown symbol (`-`) and for a part the file does not have.

| Key | Content |
|---|---|
| `format` | `"pedimap2-reader-spec/expected-content/1"` |
| `fixture` | The file's name. |
| `settings` | `POPULATION` (string), `UNKNOWN` (array of strings), `NULLHOMOZ`, `CONFIRMEDNULL` (strings), `PLOIDY` (integer), `NALLELES` (integer, or `null` in a file without IBD parts). |
| `pedigree.caption` | The caption line's tokens. |
| `pedigree.columns` | The caption's tokens after the name and the two parents: `FACTOR0`, then the factor and trait names. |
| `pedigree.individuals` | One object per row, in file order: `name`; `parent1`, `parent2` (a name or `null`); `factor0` (the `FACTOR0` value as an integer); `values` (one entry per entry of `columns`, each the token as a string, or `null` for the unknown symbol). Values are kept as strings because the file does not say which columns are numeric. In the Binko fixtures the two dummy founders are individuals like the others, with `null` for both parents and for every value but `FACTOR0`. |
| `pedigree.parents_without_row` | Names that occur as a parent but have no row of their own. Empty in all three fixtures; it holds the dummy founders for a file Binko wrote before commit `955aefa`. |
| `linkage_groups` | One object per group, in file order: `name`; `markers` (objects with `name`, `index` (the number in parentheses on the `LOCUS` line), `position_cM`, `allele_names`, and `founder_alleles`: `NALLELES` allele names with `null` for `-`, or `null` when the file has no `FOUNDERALLELES` lines); `ibd_positions_cM` (the `IBDPOSITIONS` line: an array, empty when the line lists no position, `null` when the file has no such line). |
| `genotypes` | One object per `ALLELES` section, in file order: `marker`; `rows`, each `[name, allele 1, code 1, allele 2, code 2]` with `null` for an unknown allele. An individual without a row in the section (a Binko dummy founder) has no entry. |
| `ibd` | `null`, or: `nalleles`; `founder_alleles` (one object per founder allele: its `number` 1…NALLELES, the `founder` it belongs to and that founder's `homologue` 1 or 2); `positions` (one object per `IBDPOSITION` section, in file order: `linkage_group`, `position_cM`, and `rows`, each with `name`, `h1` (the NALLELES probabilities of the first homologue) and `h2` (those of the second)). An individual without a row in the section (a Binko dummy founder) has no entry. |
| `counts` | Individuals (pedigree rows), founders, linkage groups, markers, genotype sections and rows, IBD positions and rows. |

In the Binko expected files the probabilities are the values as printed (four decimals), computed from the IBD result
by the writer's documented rule (normalize, round, put the rounding residual on the largest entry).

## Provenance

Written fresh from three kinds of sources only: the specifications of the Binko.jl repository
(`docs/specs/flexqtl-output-formats.md` sections 7.4 and 15, `phase-4-visualization.md` sections 7.2, 7.3 and 10,
`design-decisions.md` D9 and D15, `flexqtl-blackbox.md`); Binko's writers and readers (`src/Markers.jl`,
`src/Pedigree.jl`, `src/IBD.jl`, `src/Views.jl`) and their tests; and two files FlexQTL 0.99130 wrote from simulated
data, both in that repository. No Pedimap source code was read and no Pedimap manual text was read from the manual or
copied. No real data was used: every individual, marker, genotype and trait value in this directory is simulated. The
FlexQTL binaries were not run, opened or inspected for this work; the FlexQTL fixture comes from an archived output
file.

Two passages of the Binko specifications summarize Pedimap's manual (`flexqtl-output-formats.md` 7.4, its last item,
and `phase-4-visualization.md` 7.1). No rule of this specification rests on them and none of their wording is
reproduced; the one statement about the manual in the specification is the project lead's sentence, quoted as his.

No name or e-mail address of a person is in this directory.

## What is not covered

- How Pedimap itself reads the file, and any part of Pedimap's format that neither FlexQTL 0.99130 nor Binko writes.
- A legacy (QTL-run) file written by FlexQTL: none from simulated data was among the sources. The legacy layout as
  FlexQTL writes it rests on the Binko specification and on Binko's legacy writer, which the Binko project verified
  against FlexQTL's files of two reference runs (every line that is not a comment, byte for byte).
- A file written by `Binko.Views.write_pedimap` (from a QTL run's stored draws): described from its code, no fixture.
- A file written by Binko before commit `955aefa`: no fixture. The self-check derives that form from `binko_ibd.ped`
  for the one difference that matters to a reader, the missing pedigree rows of the dummy founders.
- Null alleles (`null`, `$`), individuals or markers with blanks in their names, ploidy other than 2, indicator codes
  3, 4, 6, 8, 9 and 12 (described from the sources; no fixture holds them).
- Other FlexQTL versions. The Binko specification states that the 2012 version (0.99092) writes the same layout with
  a legend that lacks codes 11 and 12.
- Binko's modern exchange tables (`binko-pedimap-exchange/0.1`), which are a different format.

## Changes in the second version (2026-11-19)

By two decisions of the project lead after the first review:

1. The contact lines of FlexQTL's head are replaced by one placeholder comment line in the FlexQTL fixture and in
   the specification's quotation of the head; `make_fixtures.jl` makes the fixture that way from the repository's file.
2. The two Binko fixtures and their expected JSON are regenerated with Binko's writers of commit `955aefa`: a pedigree
   row for each dummy founder, the `;founders` comment row with separated names, the `FACTOR0` note and the code
   legend in Binko's own words. The specification is brought up to date wherever these appear (its sections 2.6, 3.2,
   3.4, 4.1, 4.2, 5.2, 5.5, 6, 7 and 8), and its new section 5.9 states what each program writes for a founder
   without data.
