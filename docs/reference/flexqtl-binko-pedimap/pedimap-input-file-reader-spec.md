# The Pedimap input file as FlexQTL 0.99130 and Binko.jl write it: a reader's specification

Draft of 2026-11-19 (second version, after the project lead's first review) for the Pedimap 2 project
(github.com/Fresnedo-Lab/pedimap2).

**What this document is.** It describes the text file that FlexQTL 0.99130 and Binko.jl write as input for the
pedigree-visualization program Pedimap: what the two programs write, as observed in their files and as Binko's writers
define it. It is **not** Pedimap's own format documentation. It says nothing about how Pedimap reads a file, with one
exception: a sentence the project lead supplied, quoted as his in section 2.6.

**Who it is for.** Someone writing a program that reads these files. Every rule names what it rests on, and every rule
has a literal example from the test files in `fixtures/`.

## 1. Scope and sources

### 1.1 Terms

- **Pedimap input file.** One text file holding a pedigree with factor and trait values, a linkage map, marker
  genotypes with a status code, and optionally identity-by-descent probabilities. FlexQTL and Binko name it
  `pedimap.ped`.
- **FlexQTL.** A program for Bayesian QTL mapping in pedigreed populations; version 0.99130 throughout. **Binko.jl**
  (Binko) is a Julia reimplementation of FlexQTL's method; version 0.1.0 at commit `955aefa` (2026-11-19)
  throughout. Three rules differ for files Binko wrote before that commit; each says so where it stands (3.2, 3.4,
  5.5).
- **Dummy founder.** Binko's name for the founder without data that it creates to stand for the unknown parent of an
  individual with one known parent (3.2). A **founder without data** is any founder with no factor or trait value
  and no genotype; FlexQTL's files can hold such founders too, when its input lists them (5.9).
- **Legacy layout.** The file of an ordinary QTL run: pedigree, map, loci, genotypes. No IBD parts.
- **IBD.** Identity by descent: two allele copies are identical by descent when one is a copy of the other or both are
  copies of the same ancestral allele.
- **Route B.** The Binko project's name for FlexQTL's fixed-position run (`indicQTL 2` in FlexQTL's parameter file),
  which computes IBD probabilities at chosen map positions and writes them into the file. A route B file is the
  legacy layout plus the **IBD sections** (section 5).
- **Individual.** One member of the pedigree, named in the first field of a pedigree row.
- **Founder.** An individual with both parents unknown.
- **Homologue.** One of the two copies of a chromosome an individual carries (the files are for diploids). The *first*
  homologue is the one inherited from the first parent, the *second* the one from the second parent (5.5).
- **Founder allele.** One of the two chromosome copies of a founder at a given position; with *F* founders there are
  2*F* founder alleles, numbered 1 to 2*F* (5.2). Binko's sources call the same thing a founder haplotype.
- **Linkage group.** A chromosome of the map. **Locus** and **marker** are used for the same thing: a named position
  of the map with genotypes.
- **Indicator code.** The integer that follows each allele in a genotype row and states how the genotype was
  obtained (section 4).

### 1.2 What is covered

(a) The file as FlexQTL 0.99130 writes it: the legacy layout, and the IBD sections of route B (`NALLELES`,
`FOUNDERALLELES`, `IBDPOSITIONS`, `IBDPOSITION`). (b) The file as Binko writes it, by three writers: the legacy writer
(`Markers.write_pedimap`), the IBD writer (`IBD.write_pedimap_ibd`, used by Binko's IBD mode `run_ibd`), and the
writer from a finished QTL run (`Views.write_pedimap`, which calls the IBD writer). (c) Every difference between the
two programs' files (section 6).

### 1.3 Sources, and how each rule is marked

Each rule ends with one or more of these marks.

| Mark | Source |
|---|---|
| **[O]** | The Binko repository's specification of FlexQTL's output files, `docs/specs/flexqtl-output-formats.md`: section 1 (conventions), 4.5 (the consistency classes), 7.4 (the legacy Pedimap file) and 15 (the file-by-file comparison of FlexQTL versions). Section 7.4 was determined on two reference runs of FlexQTL 0.99130, and Binko's legacy writer reproduces the files of those runs byte for byte. |
| **[V]** | `docs/specs/phase-4-visualization.md`, sections 7.2 and 7.3 (FlexQTL's route B and its file; Binko's writers) and 10 (as built). |
| **[D]** | `docs/specs/design-decisions.md`, D9 (Binko's IBD mode) and D15 (FlexQTL's labeling of founder alleles). |
| **[B]** | `docs/specs/flexqtl-blackbox.md`: the record of runs of FlexQTL as a black box on prepared inputs; rows (a), (b) and (l). |
| **[W]** | Binko's code: the named function of `src/Markers.jl`, `src/Pedigree.jl`, `src/IBD.jl` or `src/Views.jl`. A rule marked [W] is what Binko writes by construction. |
| **[F]** | **Observed in the fixtures only**: seen in the two files FlexQTL 0.99130 wrote from simulated data, and stated by none of the specifications. The two files are `sim_small_ibd` (the fixture `flexqtl_routeB_sim_small.ped`: 74 individuals, 42 markers, 42 IBD positions; the fixture is FlexQTL's file with the three contact lines of its head replaced by one placeholder line, 2.6) and `p43_sim_deep_ibd_pos` (read from the Binko repository, not copied: 212 individuals, 102 markers, one IBD position). Counts are given; `make_fixtures.jl` prints them. A rule marked [F] alone holds for these two files and may not hold in general. |
| **[C]** | Checked on the Binko fixtures (`binko_legacy.ped`, `binko_ibd.ped`) by `make_fixtures.jl`. |

No real data was used. No FlexQTL legacy file (the file of a QTL run) from simulated data was among the sources, so
the legacy layout as FlexQTL writes it rests on [O] and on the two route B files, which contain every legacy part.

Two passages of the Binko specifications summarize Pedimap's manual ([O] 7.4, last item; `phase-4-visualization.md`
7.1). No rule here rests on them.

### 1.4 The fixtures

| Fixture | Writer | Individuals | Founders | Linkage groups | Markers | IBD positions |
|---|---|---|---|---|---|---|
| `binko_legacy.ped` | Binko, legacy writer | 26: 24 with data and 2 dummy founders | 8, two of them dummy founders | 3 | 11 | none |
| `binko_ibd.ped` | Binko, IBD writer | 26: 24 with data and 2 dummy founders | 8, two of them dummy founders | 3 | 11 | 3 (5 and 20 cM on group 1, 30 cM on group 3) |
| `flexqtl_routeB_sim_small.ped` | FlexQTL 0.99130, route B | 74 | 29 | 2 | 42 | 42 (every marker) |

Each has its expected parsed content beside it as `<name>.expected.json` (layout in `README.md`).

## 2. Lexical rules

### 2.1 Characters and lines

The files are plain ASCII text with lines ended by a line feed. [F][C] Lines can be long: an IBD row holds
2 × `NALLELES` numbers, 611 characters in the FlexQTL fixture (`NALLELES = 58`) and 347 in `binko_ibd.ped`
(`NALLELES = 16`). The last line has no line end in FlexQTL's files [F] and in Binko's legacy file [W:
`write_pedimap_alleles`]; Binko's IBD file ends with a line feed [W: `write_pedimap_ibd`]. FlexQTL's rows often end in
blanks [F].

### 2.2 Comments

A semicolon starts a comment that runs to the end of the line. [O 1][W: `IBD.read_pedimap_ibd` drops the text after
`;`] Comments occur in two ways:

- whole lines, in the file's head, in the legends, and as column guides inside the IBD sections;
- at the end of the `ALLELES` and `IBDPOSITION` lines:

```
ALLELES M1_001               ; (1), LG 1      0.000
IBDPOSITION     0.000<TAB><TAB>; Linkage Group 1
```

A reader removes the text from the first `;` on, then handles what is left. No information that a reader needs is
only in a comment, with one exception that section 5.5 treats: both programs name the linkage group of an
`IBDPOSITION` section only in its comment.

### 2.3 Blank lines

Blank lines (empty, or blanks and tabs only) separate the parts and carry no meaning. Their number differs between
places (one before `MAP`, five after the pedigree table, three between linkage groups).
A reader skips them. [F][W]

### 2.4 Separators and names

Fields are separated by runs of blanks; tabs occur too and count as blanks. A tab is written in three places: after
`CONFIRMEDNULL =`, between the locus name and the index on a `LOCUS` line (two tabs), and before the comment of
FlexQTL's `IBDPOSITION` line (two tabs). [O 7.4][F][W]

The columns are padded for alignment (names to 20, 21 or 24 characters, values right-aligned), but a field longer
than its pad pushes the rest of the line to the right. A reader splits on white space and never reads by column
offset. [W: `write_pedimap_pedigree`, `write_pedimap_alleles`]

Names (of individuals, traits, linkage groups, loci, alleles) are written as they are in the data file and the map
file, without quotes. Every name in the sources is free of blanks, tabs and semicolons. Neither writer quotes or
escapes anything, so a name with a blank would break the row it is in (section 8, point 6). Names are case
sensitive: Binko's readers and writers compare them exactly. [W]

Numbers use a point as the decimal separator. [F][W]

### 2.5 Keywords

All keywords are written in upper case. A **settings line** is a keyword, an equals sign and a value:
`PLOIDY     = 2`. A **section keyword** is the first field of its line: `PEDIGREE`, `LINKAGEGROUP`, `MAP`, `LOCUS`,
`ALLELENAMES`, `FOUNDERALLELES`, `IBDPOSITIONS`, `ALLELES`, `IBDPOSITION`. `IBDPOSITIONS` (one line per linkage
group) and `IBDPOSITION` (one section per position) differ by one letter; a reader compares whole fields. Binko's own
reader compares keywords without regard to case [W: `read_pedimap_ibd`]; no file in the sources has a keyword in
lower case.

### 2.6 The head of the file

The head is the comment lines before the first settings line. **A reader must not depend on it.** The project lead:
"the manual allows header lines to be omitted and origin lines are comments". The two programs write different
heads.

FlexQTL 0.99130 (the first five lines of the fixture; line 4 is empty): [O 7.4][F]

```
; Output from FlexQTL software for visualisation by Pedimap software
; generated by: FlexQTL 0.99130 (16.FEB.2016)
; generated at: Mon, 12 Oct 2026, 00:31:22

; [placeholder of pedimap2-reader-spec] FlexQTL 0.99130 writes three contact lines at this place, for Pedimap's author and its own; they are left out of this fixture
```

The fifth line is not FlexQTL's. At its place FlexQTL writes three comment lines: one that introduces the contacts,
and one each for the author of Pedimap and the author of FlexQTL, with a name and an e-mail address. By the project
lead's decision of 2026-11-19 the fixture and this quotation hold the placeholder line instead; the fixture differs
from FlexQTL's own file by exactly those lines (`README.md`). A file as FlexQTL writes it has seven head lines before
the blank line that precedes `POPULATION`.

Binko since 2026-11-19 (the constant `Markers.PEDIMAP_WRITER_LINE`, then two lines; `binko_legacy.ped`): [W]

```
; Pedimap data file written by Binko.jl 0.1.0 (format: the layout of FlexQTL 0.99130's Pedimap output; not written by FlexQTL)
; generated by: Binko (Markers.write_pedimap), fixture of pedimap2-reader-spec
; generated at: fixture (a run writes its date here)
```

The version in the first line is the package's version and changes with it. The text after `generated by:` is whatever
the caller passes (Binko's IBD mode writes `Binko run_ibd`), and the text after `generated at:` is a date in FlexQTL's
form, or empty. Binko's files carry no contact lines. Binko's IBD writer adds two more comment lines (and the writer
from a QTL run three more after those): [W: `write_pedimap_ibd`, `Views.write_pedimap`]

```
; IBD probabilities over 16 founder haplotypes (2 per founder, dummy founders included);
; haplotype 2f - 1 of founder f carries the founder's smaller allele code at the anchor marker (anchorMarker 0; FlexQTL's labeling, D15).
```

Files written by Binko before 2026-11-19 (before its commit `1e26be1`) open with FlexQTL's first line, and those of
its legacy writer also carry FlexQTL's contact lines; from the first settings line on they do not differ from today's.
[W: the change of that commit] So the first line does not tell reliably which program wrote a file.

## 3. The legacy layout, in file order

The parts, in the order both programs write them. Parts in brackets exist only in a file with IBD sections.

```
head (comment lines)
settings lines: POPULATION, UNKNOWN, NULLHOMOZ, CONFIRMEDNULL, PLOIDY [, NALLELES]
comment lines: a note on FACTOR0 (four lines)
PEDIGREE
  caption line
  one row per individual
for each linkage group:
  LINKAGEGROUP name
  MAP
    one row per locus: name, position
  for each locus:
    LOCUS name (index)
    ALLELENAMES names
    [FOUNDERALLELES names]
  [IBDPOSITIONS positions]
comment lines: the legend of the indicator codes (nineteen lines)
for each locus, in map order:
  ALLELES name
    one row per individual (Binko: except dummy founders): name, allele, code, allele, code
[for each IBD position:
  IBDPOSITION position
    comment rows
    one row per individual (Binko: except dummy founders): name, 2 x NALLELES probabilities]
```

Sources of the order: [O 7.4] for the legacy parts, [V 7.2][V 10] for the IBD parts, [W], and the three fixtures.

### 3.1 The settings lines

Five lines, always present and always in this order, in both programs' files: [O 7.4][W: `write_pedimap`][F]

```
POPULATION = sim_small_fq.dat
UNKNOWN    = * -
NULLHOMOZ  = $
CONFIRMEDNULL =<TAB>null
PLOIDY     = 2
```

| Keyword | Value written | What it holds |
|---|---|---|
| `POPULATION` | FlexQTL: the name of the run's data file. Binko: the base name of the data file, or the name its caller passes. | A name for the data set. One field without blanks in every file of the sources. |
| `UNKNOWN` | `* -` in every file | The strings that stand for "unknown", separated by blanks. Only `-` is ever written as a value: `*` occurs nowhere else in the three fixtures or in the second FlexQTL file outside comments, and Binko's writers print only `-`. [F][W] Where `-` is written: an unknown parent, a missing factor or trait value, an unknown allele in an `ALLELES` row, an unknown allele on a `FOUNDERALLELES` line. |
| `NULLHOMOZ` | `$` in every file | A symbol for a null allele. In FlexQTL's data files `$` is the symbol of a putative null allele and `$$` that of a confirmed one ([O 1]; parameter keys `nullalleleP`, `nullalleleC`). No fixture has `$` in a genotype row, and the sources do not say when either program writes it there (section 8, point 3). |
| `CONFIRMEDNULL` | `null` in every file, after a tab | The name under which a confirmed null allele (`$$` in the data file) is written, on `ALLELENAMES` lines and in `ALLELES` rows. [O 7.4][W: `pedimap_token`] Not in the fixtures: the simulated sets have no null alleles. |
| `PLOIDY` | `2` in every file | The number of alleles per genotype row. |

A file with IBD sections has a sixth line after `PLOIDY` (5.1): `NALLELES   = 58`.

A reader splits a settings line at the first `=` and trims both sides. After the settings come four comment lines
that explain `FACTOR0` (4.1). FlexQTL writes them in its own wording; Binko writes, at the same place and in as many
lines, a note in its own words (4.1). [F][W: `Markers.PEDIMAP_FACTOR_NOTE`] They are comments.

### 3.2 The pedigree section

The line `PEDIGREE`, a caption line, and one row per individual. From `binko_legacy.ped`:

```
PEDIGREE
NAME                PARENT1             PARENT2                      FACTOR0       Gwrite        Block            y 
F001                 -                    -                                0            1            2       9.0848
F005                 -                    -                                0            1            2            -
G1_001               F005                 F002                             1            1            2      11.2554
DUMMY_G1_007_F       -                    -                                0            -            -            -
G1_007               DUMMY_G1_007_F       F004                             2            1            1       9.0316
DUMMY_G2_004_M       -                    -                                0            -            -            -
G2_004               G1_002               DUMMY_G2_004_M                   2            1            1            -
```

**The caption** names the columns: `NAME`, `PARENT1`, `PARENT2`, `FACTOR0`, then further column names. It ends with a
blank. FlexQTL's caption in both of its files is `NAME PARENT1 PARENT2 FACTOR0 Gwrite y`: after `FACTOR0` come the
data file's nuisance-factor column (`Gwrite`, which in FlexQTL's data file marks the individuals whose genotype
samples are written) and its traits. [O 7.4][F] Binko writes `FACTOR0`, then the name of every nuisance-factor column
of the data file, then every trait name. [W: `write_pedimap_pedigree`] Nothing in the file tells a factor column from
a trait column; a reader that needs the distinction must be told, or must treat every column after `PARENT2` alike.

**The rows.** Each row has exactly as many fields as the caption:

1. the individual's name;
2. the first parent's name, or `-`;
3. the second parent's name, or `-`;
4. `FACTOR0`: 0, 1 or 2 (4.1);
5. onward: one value per remaining caption column, written as the text of the data file, or `-` when missing.
   [W][F: the 74 trait and 74 `Gwrite` values of the FlexQTL fixture are the tokens of the run's data file]

**Order.** Parents come before their offspring: in the FlexQTL fixture and the second FlexQTL file no parent's row
follows its offspring's [F]; FlexQTL's files are in its sorted pedigree order, in which every parent precedes its
offspring [O 1]; Binko writes its internal pedigree order, which has the same property [W: `Pedigree.Ped`]. The same
order is used for the rows of every `ALLELES` and `IBDPOSITION` section (3.4, 5.5).

**Every parent has a row.** In FlexQTL's files and in Binko's files from commit `955aefa` on, every name in a parent
column is the name of a row of the table. [F: no parent without a row among 74 and 212 individuals][W:
`write_pedimap_pedigree`][C: none among 26] Binko's older files are the exception described next.

**Which parent is which.** `PARENT1` is the parent in the data file's first parent column and `PARENT2` the one in
its second. In FlexQTL's data-file template and in Binko's simulated sets these columns are headed `Female` and
`Male`. [W: `Pedigree` module documentation] The Pedimap file itself does not state a sex.

**Founders** have `-` for both parents.

**An individual with one unknown parent.** FlexQTL does not accept such an individual in its input, so none occurs in
a file it writes. [O 7.4][F: 0 of 74 and 0 of 212 rows] Binko accepts it and gives it a *dummy founder*: an
individual without data that stands for the missing parent, named `DUMMY_<individual>_F` when the first parent is the
missing one and `DUMMY_<individual>_M` when the second is. [W: `Pedigree.Ped`] In the file the individual has two
named parents, and the dummy founder is written as follows.

- **In the pedigree table the dummy founder has a row**: its name, `-` for both parents, `FACTOR0` 0, and `-` in
  every other column. The row stands immediately before the row of its offspring. [W: `write_pedimap_pedigree`,
  `Pedigree.Ped`][C: the rows of `DUMMY_G1_007_F` and `DUMMY_G2_004_M` above, before `G1_007` and `G2_004`]
- **In the `ALLELES` and `IBDPOSITION` sections the dummy founder has no row.** [W: `write_pedimap_alleles`,
  `write_pedimap_ibd`][C: 24 of the table's 26 individuals in every section] Section 5.9 sets this beside what
  FlexQTL writes for a founder without data.
- **Version.** Files written by Binko before commit `955aefa` name a dummy founder in a parent column without a row
  for it; files written from that commit on have the row. A reader that must take the older files accepts a parent
  name without a row as a founder without data (it counts as a founder for the IBD sections, 5.2).

In the FlexQTL fixture the nine individuals named `DUMMY_…` are ordinary individuals of FlexQTL's input: the data
file given to FlexQTL listed them as founders without data (see `README.md`). FlexQTL writes rows for them in every
section (5.9).

### 3.3 The linkage groups: map and loci

After the pedigree table, for each linkage group in map order: `LINKAGEGROUP` and the group's name; `MAP` and one row
per locus; then one block per locus. From `binko_legacy.ped`, group 3:

```
LINKAGEGROUP 3

MAP
M3_001                   2.500
M3_002                  15.000
M3_003                  30.000

LOCUS          M3_001              <TAB><TAB>(9)
ALLELENAMES     102 110  98

LOCUS          M3_002              <TAB><TAB>(10)
ALLELENAMES       1   2   3   4
```

- **`LINKAGEGROUP name`.** The name is the group's label in the map file (`1`, `2`, … in every file of the sources).
  [O 7.4][W]
- **`MAP` rows.** The locus name and its position in centiMorgan with three decimals, in map order, which is
  ascending position. [O 7.4][W: `write_pedimap_map`] FlexQTL formats the position from its internal value
  (chromosome × 100 + Morgan), so the last printed digit can differ from the map file's by rounding; Binko's writer
  reproduces that arithmetic. [O 7.4][W: `flexqtl_cM`]
- **`LOCUS name (index)`.** One block per locus of the group, in map order. After the name and two tabs comes the
  locus's index in parentheses: its 1-based rank among all loci of the map, across linkage groups (`(9)` is the first
  locus of group 3 because groups 1 and 2 hold eight). [O 1][O 7.4][F][C] **The index is not in a comment.** A reader
  must accept this third field; it may ignore it or check it.
- **`ALLELENAMES`.** The names of the alleles that can occur at the locus. FlexQTL lists the union of the alleles of
  its raw data file and of its consistency-checked copy of the data, with `null` for a confirmed null allele, sorted.
  [O 7.4] Binko lists the same union, sorted as character strings, which is why `102 110 98` above is not in numeric
  order. [W][C] How FlexQTL orders integer names is not known (section 8, point 4); a reader treats the line as a
  set. The unknown symbol is never listed.

A file with IBD sections adds a `FOUNDERALLELES` line to every locus block and an `IBDPOSITIONS` line after the last
locus block of every group (5.3, 5.4).

### 3.4 The genotype sections

After the last linkage group comes a block of nineteen comment lines, the legend of the indicator codes (4.2), and
then one `ALLELES` section per locus, in map order. [O 7.4][W][F][C] From `binko_legacy.ped`:

```
ALLELES M2_003               ; (7), LG 2     20.000
F001                    T 0    T 0
F002                    T 1    G 1
F003                    T 0    T 0
F004                    G 2    T 2
F005                    - 5    - 5
...
G1_007                  T 7    T 7
```

- **The section line** is `ALLELES` and the locus name. The rest (index, linkage group, position) is a comment that
  repeats the map. [O 7.4]
- **The rows.** One row per individual, in the pedigree table's order, the same individuals in every section: the
  name, then for each of the two alleles the allele and an indicator code. A row has five fields. FlexQTL writes a
  row for every individual of the table, the founders without data included. [O 7.4][F: every section of both
  FlexQTL files lists every individual in table order] Binko writes a row for every individual except its dummy
  founders. [W: `write_pedimap_alleles`][C: every section of both Binko fixtures lists the same 24 of the table's 26
  individuals, in table order] So an individual of the table can be absent from the `ALLELES` sections; its genotypes
  are then unknown.
- **The alleles** are names from the locus's `ALLELENAMES` line (or `null`), or `-` for unknown.
- **The two codes of a row are always equal**: the code describes the genotype, not the single allele. [W:
  `write_pedimap_alleles` prints one code twice][F: 3,108 of 3,108 and 21,624 of 21,624 rows] Section 4.2 lists the
  codes.
- **Which alleles are shown.** FlexQTL shows the most probable phased genotype of its run (the alleles of its file
  `lockedphases.new`), with two exceptions: for codes 5 and 7 it shows the alleles of the raw data file, and a
  genotype left without a most probable phase is shown as `-` with code 11 or 12. [O 7.4] Binko's legacy writer
  follows the same rules with its own phases and classes [W: `pedimap_codes`, `pedimap_alleles`]; Binko's other two
  writers differ (section 6, rows 15 to 17).
- **The order of the two alleles.** In FlexQTL's files the first allele is the one on the first homologue (the one
  from `PARENT1`) and, for a founder, the one on its odd-numbered founder allele (5.2). This is observed, not stated
  by a specification: in the FlexQTL fixture, at the 42 markers that are also IBD positions, every heterozygous
  non-founder genotype whose two homologues are each assigned to a founder allele with probability 0.9 or more has
  its first allele on the first homologue (293 of 293; 55 of 55 in the second file), and every founder row equals
  that founder's two entries of the `FOUNDERALLELES` line in order (840 of 840; 2,015 of 2,015). [F] Binko's legacy
  and IBD writers print an ordered pair too (first allele from the first parent) [W: `Descent.locked_phases`,
  `posterior_pedimap_alleles`], but for a founder the order is the sampler's own and does not follow the
  founder-allele numbers (section 6, row 14).

## 4. The indicator codes

### 4.1 `FACTOR0`: the kind of pedigree member

The fourth column of the pedigree table. [O 7.4][W: `write_pedimap_pedigree`]

| Value | Meaning |
|---|---|
| 0 | Founder: both parents unknown. |
| 1 | Has known parents and has offspring in the pedigree. |
| 2 | Has known parents and no offspring in the pedigree. |

The value follows from the pedigree table itself: it holds in 74 of 74 rows of the FlexQTL fixture, 212 of 212 of the
second FlexQTL file [F] and 26 of 26 of each Binko fixture [C]. In Binko's files a dummy founder (3.2) has 0, and an
individual whose parent is a dummy founder has known parents in this sense and gets 1 or 2. [W]

Both programs explain the column in four comment lines before `PEDIGREE`. FlexQTL's are in its own wording (it calls
the three kinds founder, intermediate and final offspring). Binko's, from commit `955aefa` on, are: [W:
`Markers.PEDIMAP_FACTOR_NOTE`]

```
; FACTOR0, written by Binko, gives each individual's place in the pedigree:
;   0 : a founder (its parents are unknown)
;   1 : an individual with known parents and with offspring
;   2 : an individual with known parents and without offspring
```

Before that commit Binko wrote FlexQTL's four lines.

### 4.2 The genotype codes

The code after each allele of an `ALLELES` row. Codes 0 to 9 are the consistency classes FlexQTL assigns to every
genotype when it checks the marker data against the pedigree before sampling (its file `mconsistency.csv`); 11 and 12
are added when the Pedimap file is written. [O 4.5][O 7.4] The short names are FlexQTL's labels of the classes, from
the legend it writes as a comment block before the first `ALLELES` section; the meanings below are worded for this
document.

| Code | Short name | Meaning | Alleles shown |
|---|---|---|---|
| 0 | OC | Observed, and consistent with the pedigree. | The phased genotype. |
| 1 | MA | Missing in the data and filled in from the relatives' genotypes ("augmented"). | The filled-in genotype. |
| 2 | OEA | Observed, judged an error, removed and filled in again. | The filled-in genotype. |
| 3 | pnuA | Involves a putative null allele; the genotype was completed. | The completed, phased genotype. |
| 4 | pnuM | Involves a putative null allele; the genotype was left missing. | What the run's most probable phase holds for it. |
| 5 | IM | Incomplete or fully missing in the data and not filled in. | The alleles of the raw data file: `-` for each missing one. |
| 6 | OpE | Observed and flagged as a possible error, but kept. | The phased genotype. |
| 7 | OE | Observed, judged an error and removed. | The alleles of the raw data file (the genotype that was judged wrong). |
| 8 | pnuE | Involves a putative null allele and is in error. | What the run's most probable phase holds for it. |
| 9 | ME | Labeled "missing and error" by FlexQTL; the sources do not say what produces it. | What the run's most probable phase holds for it. |
| 11 | OPhE | Class 0, 2 or 6 for which the run gave no most probable phase. | `-` for both alleles. |
| 12 | MAPhE | Class 1 for which the run gave no most probable phase. | `-` for both alleles. |

Sources of the table: the code numbers and short names, [O 4.5] and [O 7.4] (which record that the 2012 version of
FlexQTL writes the same file without codes 11 and 12 and with code 5 worded "incomplete and missing", [O 15]). The
rule for 11 and 12 and the rule that codes 5 and 7 show the raw alleles were measured by the Binko project on a
reference run, where they reproduce every code of the file; for every other code the alleles are those of the
run's most probable phase, `-` where it has none. [O 7.4][W: `pedimap_codes`, `pedimap_alleles`] The
meanings of 1, 2, 3, 6 and 7 are also those of Binko's own consistency pass. [W: `Markers.consistency_pass`,
`consistency_codes`] Codes 10 and above 12 are not written by either program.

Where each code occurs in the files of the sources (rows):

| Code | FlexQTL fixture (`sim_small_ibd`) | FlexQTL second file (`p43_sim_deep_ibd_pos`) | `binko_legacy.ped` | `binko_ibd.ped` |
|---|---|---|---|---|
| 0 | 2,717 | 21,087 | 231 | 236 |
| 1 | | 156 | 9 | 28 |
| 2 | | 11 | 1 | |
| 5 | 378 | 267 | 19 | |
| 7 | | 6 | 4 | |
| 11 | 13 | 97 | | |

[F][C] In these files every row of code 0, 1, 2 or 7 has both alleles, and every row of code 5 or 11 has `-` for
both. Codes 3, 4, 6, 8, 9 and 12 occur in no file from simulated data; [O 7.4] records 3, 4 and 9 in a reference
run's file, and none of 6, 8 and 12. Examples from the fixtures:

```
G1_001                  G 1    A 1          (binko_legacy.ped, M1_001: filled in)
F004                    G 2    T 2          (binko_legacy.ped, M2_003: error, filled in again)
F003                    - 5    - 5          (binko_legacy.ped, M1_001: missing)
G1_007                  T 7    T 7          (binko_legacy.ped, M2_003: error, raw alleles shown)
G1_003                  - 11    - 11        (flexqtl_routeB_sim_small.ped, M1_002: no phase)
```

**The legend in the file.** Both programs write a legend of nineteen comment lines before the first `ALLELES`
section. FlexQTL's is in its own wording. Binko's, from commit `955aefa` on, is in Binko's words, with FlexQTL's label
of each class in parentheses, and has as many lines, so that every line that is not a comment stands at the same
line number as in FlexQTL's file: [W: `Markers.PEDIMAP_LEGEND`][C]

```
;***************************************************************************
; Binko: the code written after each allele is the class of the genotype in the
; marker consistency check, numbered as FlexQTL numbers its classes
; (FlexQTL's label of the class in parentheses; docs/specs/flexqtl-output-formats.md)
; code : meaning
;  0   : observed and consistent with the pedigree (OC)
;  1   : missing, then filled in (MA)
;  2   : observed, found in error, then replaced (OEA)
;  3   : putative null allele, then resolved (pnuA)
;  4   : putative null allele, then set to missing (pnuM)
;  5   : incomplete or fully missing (IM)
;  6   : observed, a putative error (OpE)
;  7   : observed, found in error (OE)
;  8   : putative null allele, found in error (pnuE)
;  9   : missing, found in error (ME)
;*************************
; 11   : observed and consistent, with a phasing error (OPhE)
; 12   : missing and filled in, with a phasing error (MAPhE)
;***************************************************************************
```

Before that commit Binko wrote FlexQTL's legend. Binko's IBD writer writes the same legend although it uses only
three of the codes (below). The legend is a comment: a reader takes the meanings from this section, not from the file.

**Which codes each Binko writer can produce.** The legacy writer: any class of Binko's consistency pass (0, 1, 2, 3,
4, 5, 6, 7, 8) and 11, 12. The IBD writer: only 0 (the genotype is in the data), 1 (missing in the data; the
posterior fills both alleles) and 5 (missing; not filled). The writer from a QTL run: only 0 (both alleles in the
data) and 5 (one or both missing). [W: `consistency_pass`, `posterior_pedimap_alleles`, `Views.write_pedimap`]

A reader should accept any non-negative integer as a code and keep it, and treat a code it does not know as
"no statement".

## 5. The IBD sections of route B

### 5.1 What a file with IBD sections adds

Four things, at four places: [V 7.2][V 10][W: `write_pedimap_ibd`][F]

1. a settings line `NALLELES` after `PLOIDY`;
2. a `FOUNDERALLELES` line in every `LOCUS` block, after `ALLELENAMES`;
3. an `IBDPOSITIONS` line after the last `LOCUS` block of **every** linkage group;
4. one `IBDPOSITION` section per position, after the last `ALLELES` section.

Everything else is the legacy layout. A QTL run's file has none of the four. [O 7.4][V 7.2]

### 5.2 `NALLELES` and the numbering of founder alleles

```
NALLELES   = 58
```

`NALLELES` is the number of founder alleles: **two per founder**. [V 7.2][D D9][W] The fixture has 29 founders and
`NALLELES = 58`; the second FlexQTL file 20 and 40; `binko_ibd.ped` 8 and 16.

**Numbering.** The founders are taken in order, and founder number *f* owns the founder alleles 2*f* − 1 and 2*f*.
Everything in the IBD sections that is "per founder allele" is in this order: the entries of a `FOUNDERALLELES` line
and the probabilities of each homologue in an `IBDPOSITION` row.

**The order of the founders** is the order of the pedigree table: founder *f* is the *f*-th row with both parents
unknown. In FlexQTL's files this is observed: every founder's own row has probability 1 at 2*f* − 1 in the first
half and at 2*f* in the second, for *f* its rank among the table's founders (1,218 of 1,218 founder rows in the
fixture, 20 of 20 in the second file). [F] FlexQTL's comment rows number the founders 1, 2, … without naming them.

**Founders without data count.** In the FlexQTL fixture the nine founders without data are rows of the table and are
founders 1 to 9 (they are the first rows). In Binko's files a dummy founder owns two founder alleles like any other
founder [D D9][W], and its place in the order is the place of its row, which stands immediately before its
offspring's (3.2). In `binko_ibd.ped` the table's founder rows are F001 … F006, `DUMMY_G1_007_F`, `DUMMY_G2_004_M`,
which is the order of the writer's own founder list [C: the expected JSON's `ibd.founder_alleles` comes from that
list] and of the comment row `;founders` of each IBD section (5.5).

**Files written by Binko before commit `955aefa`** have no row for a dummy founder (3.2). Its place in the order is
the same, immediately before its offspring [W: `Pedigree.Ped`], and a reader finds it by walking the table: a row
with both parents `-` is the next founder; a parent name that has no row and has not been met is the next founder at
the row that names it, before that row's own turn. The script's self-check reads `binko_ibd.ped` with the two dummy
founders' rows removed and finds the same eight founders in the same order. [C]

The reader's check in every case: `NALLELES` equals twice the number of founders.

### 5.3 `FOUNDERALLELES`: the allele on each founder allele

One line per locus, after `ALLELENAMES`, with `NALLELES` entries in the order of 5.2: the allele name each founder
allele carries at this locus, or `-` when unknown. From the fixture (the line has 58 entries; the first 18, of the
nine founders without data, are `-`):

```
LOCUS          M1_001              <TAB><TAB>(1)
ALLELENAMES       A   G
FOUNDERALLELES     -    -    -   ...   -    G    G    A    G    G    G    A    G   ...
```

and from `binko_ibd.ped`:

```
LOCUS          M3_001              <TAB><TAB>(9)
ALLELENAMES     102 110  98
FOUNDERALLELES  102 110  98 110  98 110 110 110 102 110  98 102  98  98  98  98
```

- In FlexQTL's files the entries 2*f* − 1 and 2*f* are the two alleles of founder *f*'s own `ALLELES` row at that
  locus, in the same order (840 of 840 founder genotypes in the fixture, 2,015 of 2,015 in the second file), and both
  are `-` where the founder's row is `-` (378 and 25). [F] So a founder without data has `-` at every locus.
- In Binko's IBD file each entry is the allele most often carried by that founder allele in the sampled states, and
  is `-` only if the founder allele was never assigned an allele. [W: `write_pedimap_ibd`] A dummy founder therefore
  has allele names, not `-` (entries 13 to 16 above), and a founder's entries need not equal its `ALLELES` row
  (section 6, row 14).

**Which of a founder's two chromosome copies is the odd-numbered one (D15).** The labeling is by an *anchor marker*:
founder allele 2*f* − 1 is the copy that carries the **smaller allele** at the anchor marker, and 2*f* the other.
[D D15][B (b)]

- *Anchor marker.* FlexQTL's parameter `anchorMarker` names two choices: 0, the founder's first informative
  (heterozygous) marker; 1, its informative marker closest to an IBD position. [V 7.2] In the files of the sources
  the anchor is the founder's first heterozygous marker of the linkage group under both settings: the Binko
  project's black-box runs found identical files under 0 and 1 [B (b)], and in both FlexQTL files, at the first
  marker of each linkage group where the founder's `ALLELES` row is heterozygous, entry 2*f* − 1 is the smaller
  allele (40 of 40 founder-and-group pairs in the fixture, written with `anchorMarker 0`; 40 of 40 in the second
  file, written with `anchorMarker 1`, where the marker nearest the IBD position fits only 17 of 20). The row's
  code does not matter: counting only rows of code 0, the second file gives 39 of 40. [F] Binko
  implements both settings as named; with 1 its labels can differ between positions. [D D9][W: `anchor_table`]
- *Smaller allele.* FlexQTL: `A` before `G`, `1` before `3`. [D D15] Binko: numerically when every allele name of
  the locus is an integer, as character strings otherwise. [D D15][W: `anchor_allele`] In `binko_ibd.ped`, founder
  F002 has the alleles `110` and `98` at M3_001, its first heterozygous marker of group 3, and its entries 3 and 4
  above are `98 110`. Binko takes the anchor from the genotypes of the data file, and from those the rule holds in
  16 of 16 founder-and-group pairs of the fixture; from the file's own `ALLELES` rows it can be checked in 15 of 16
  only, because those rows hold posterior genotypes (section 6, rows 14 and 15). [C]
- *Per linkage group.* The anchor is chosen within a linkage group, so the odd-numbered founder allele of one group
  and that of another are unrelated labels. [D D15]
- *No anchor.* A founder heterozygous nowhere on a group, or without data, has no anchor there; which copy is
  odd-numbered is then arbitrary. [D D9][B (b)]

### 5.4 `IBDPOSITIONS`: the positions of a linkage group

One line per linkage group, after the group's last `LOCUS` block: the keyword and the group's IBD positions in
centiMorgan, ascending. **The line is written for every group, and lists nothing for a group without positions.**
[V 10][W][F]

```
IBDPOSITIONS        0.000      5.000     10.000   ...    100.000        (FlexQTL fixture, group 1: 21 positions)
IBDPOSITIONS                                                             (FlexQTL, second file, group 2: none)
IBDPOSITIONS 5.0000 20.0000                                              (binko_ibd.ped, group 1)
IBDPOSITIONS                                                             (binko_ibd.ped, group 2: none)
IBDPOSITIONS 30.0000                                                     (binko_ibd.ped, group 3)
```

FlexQTL prints three decimals in fields of eleven characters and ends the line with a blank; Binko prints four
decimals separated by single blanks. [F][W] The positions are on the scale of the group's `MAP` rows. A position may
be a marker's (all 42 of the fixture; 20.0 and 30.0 in `binko_ibd.ped`) or lie between markers (5.0 in
`binko_ibd.ped`, between M1_001 at 0.0 and M1_002 at 7.5). FlexQTL gives a position equal to a marker's its own
section. [B (a)]

### 5.5 `IBDPOSITION`: the probabilities at one position

After the last `ALLELES` section, one section per position. **The sections come in the order of the linkage groups
and, within a group, in the order of its `IBDPOSITIONS` line.** [V 7.2][W][F][C]

**The section line** is `IBDPOSITION` and the position. The linkage group is named only in the comment that follows:

```
IBDPOSITION     0.000<TAB><TAB>; Linkage Group 1        (FlexQTL)
IBDPOSITION 5.0000 ; LG 1                               (Binko)
```

The position alone does not identify a section: the fixture has `IBDPOSITION     0.000` twice, once for each group.
A reader assigns the sections to the groups by counting: the *k*-th section belongs to the *k*-th position of the
`IBDPOSITIONS` lines taken in file order, and its position must equal that one.

**Comment rows** follow the section line and are column guides. FlexQTL writes six: two that label the two halves of
the columns (the first half with the words `maternal` and `founder`, the second with `paternal` and `founder`), one
with the founder numbers, one with the founder-allele numbers, one with the position and the name of the marker
there (`;(0.000)M1_001`; every position of both files is a marker's), and one that repeats that marker's founder
alleles. [F] Binko writes two: `;founders` with each founder's name twice, once for each of its two founder alleles,
the whole list given for the first half and again for the second; and `;allele number` with the numbers 1 to
`NALLELES` for each half. [W: `write_pedimap_ibd`] From `binko_ibd.ped` (the second half of each row is cut here):

```
IBDPOSITION 5.0000 ; LG 1
;founders                F001 F001 F002 F002 F003 F003 F004 F004 F005 F005 F006 F006 DUMMY_G1_007_F DUMMY_G1_007_F DUMMY_G2_004_M DUMMY_G2_004_M   ...
;allele number                   1         2         3         4         5         6         7         8         9        10   ...
```

From commit `955aefa` on the names of the `;founders` row are separated by single blanks and are not aligned with the
columns; after the word `founders` the row holds 2 × `NALLELES` names. In files written before that commit each name
was padded to ten characters, so that a longer name touched its neighbor and the row could not be split. The row is a
comment in both forms. A reader does not need it: the founders follow from the pedigree table (5.2). A reader may use
it to check them.

**Data rows.** One row per individual, in the pedigree table's order, the same individuals in every section: the
name, then 2 × `NALLELES` probabilities. FlexQTL writes a row for every individual of the table, the founders without
data included. [V 7.2][F: every section of both files lists every individual in table order] Binko writes a row for
every individual except its dummy founders. [W: `write_pedimap_ibd`][C: each of the three sections of
`binko_ibd.ped` lists the same 24 of the table's 26 individuals, in table order]

- **The first `NALLELES` values are for the first homologue, the next `NALLELES` for the second.** Value *j* of a
  half is the probability that the homologue, at this position, is a copy of founder allele *j*.
- **The first homologue is the one inherited from `PARENT1`, the second the one from `PARENT2`.** [V 7.2][D D9][W:
  `write_pedimap_ibd`] For FlexQTL's files the specifications state it and the fixtures bear it out: in every row of
  a non-founder, the first half's nonzero values lie on founder alleles of founders among the ancestors of
  `PARENT1` and the second half's on those of `PARENT2` (1,890 of 1,890 rows in the fixture, of which 1,598 would not
  fit the opposite order; 192 of 192 and 124 in the second file; 54 of 54 and 48 in `binko_ibd.ped`). [F][C]
  FlexQTL's guide words `maternal` and `paternal` agree with its data-file template, whose first parent column is
  headed `Female` (3.2).
- **A founder's own row** has probability 1 on its odd-numbered founder allele in the first half and 1 on its
  even-numbered one in the second (5.2). [D D9][F][C]

Examples from the FlexQTL fixture, group 1, position 0.000, showing only the nonzero values as *[number] value*
(`G1_001` has the parents F003, founder 12, and F010, founder 19; `G1_007` has `DUMMY_G1_007_M`, founder 1, and
F014, founder 23):

```
F002     first half: [21] 1.0                        second half: [22] 1.0
G1_001   first half: [23] 0.95  [24] 0.05            second half: [38] 1.0
G1_007   first half: [1] 0.50   [2] 0.50             second half: [45] 1.00  [46] 0.00
```

and the rows of `G1_007` (parents `DUMMY_G1_007_F`, founder 7, and F004, founder 4) and `G2_004` (parents G1_002, a
child of F005 and F002, and `DUMMY_G2_004_M`, founder 8) of `binko_ibd.ped` at 5.0 cM of group 1:

```
G1_007   first half: [13] 0.4975  [14] 0.5025                             second half: [7] 0.9040  [8] 0.0960
G2_004   first half: [3] 0.5455  [4] 0.0195  [9] 0.0125  [10] 0.4225      second half: [15] 0.5075  [16] 0.4925
```

A homologue that comes from a founder without data splits about evenly between that founder's two alleles, as in
both `G1_007` rows: nothing distinguishes them (5.9).

**Number formats.** FlexQTL prints two decimals in fields of five characters, with two special forms: a bare `0` and
`1.0`. In the fixture a half that contains `1.0` contains nothing else but `0` (3,059 of 3,059), and a half that
contains `1.00` always contains another value with decimals, such as `0.00` (335 of 335); so `0` and `1.0` appear to
be exact values and `0.00` and `1.00` rounded ones. [F] Binko prints every value with four decimals (a writer option,
`decimals`, with default 4) in fields of ten characters, with three more blanks between the two halves. [W]

### 5.6 The sum rule and its tolerance

**The probabilities of each homologue sum to 1 over the founder alleles.** [V 7.2][D D9] What a reader finds in the
file depends on the writer:

- Binko's values sum to exactly 1 as printed: the writer normalizes, rounds, and adds the rounding residual to the
  largest value. [W: `probability_tokens`] In `binko_ibd.ped` the largest deviation over 144 sums is 1.1e-16, the
  error of adding the numbers. [C]
- FlexQTL's values are rounded one by one, so a sum can miss 1 by the rounding. In the fixture the 6,216 sums range
  from 0.98 to 1.02 (5 of them at 0.98 or 1.02); in the second file the 424 sums range from 0.99 to 1.01. [F] One of
  the worst, `G3_010` at 100.000 of group 1, first half:
  0.01 + 0.00 + 0.08 + 0.83 + 0.05 + 0.01 + 0.04 = 1.02.

**Tolerance.** A value printed with *d* decimals is within half a unit of the last decimal of the value it rounds.
A reader should accept a homologue when

    |sum − 1|  ≤  m × 0.5 × 10^(−d) + 1e-9

where *d* is the number of decimals of the file's probabilities (2 for FlexQTL, 4 for Binko) and *m* is the number
of values of that homologue that are not written as a bare `0`. For the example above, *m* = 7 and the tolerance is
0.035. Every sum of the three files is within this bound; the largest deviation is two thirds of it. [F][C] A reader
that does not keep the tokens can use *m* = `NALLELES`, or a fixed tolerance of 0.05, which also accepts every sum
of the files of the sources. A reader should keep the values as read; whether to rescale them to sum to 1 for display
is its own decision.

### 5.7 Positions and units

All positions (the `MAP` rows, the `IBDPOSITIONS` lines, the `IBDPOSITION` lines) are in centiMorgan from the origin
of the linkage group's map. [O 1][W] In FlexQTL's parameter file the positions are asked for in another form
(chromosome × 100 + Morgan; `100.05` is 5 cM on chromosome 1); that form does not occur in the Pedimap file.
[V 7.2][B (a)]

### 5.8 What the probabilities are

They are posterior probabilities, from a Markov chain Monte Carlo run, that a homologue of an individual at the
position descends from each founder allele. FlexQTL's fixed-position run and Binko's IBD mode compute them from the
marker data and the pedigree (in FlexQTL the phenotypes enter the chain but move the probabilities by 0.0001 on
average in the run that tested it). [V 7.2][B (l)] The file from a Binko QTL run holds, at the loci that run tracked,
the shares of its stored draws, which are conditional on the phenotypes too; that file says so in its head.
[V 10][W: `Views.write_pedimap`] The layout is the same in all three cases.

### 5.9 A founder without data: what each program writes

A founder without data has no factor value, no trait value and no genotype. In the FlexQTL fixture there are nine
(of 29 founders): the dummy founders that the run's input file listed as individuals, because FlexQTL refuses an
individual with one known parent (`README.md`). In `binko_ibd.ped` there are two (of 8): the dummy founders Binko
created itself. What the two files hold for them, counted by `make_fixtures.jl`: [F][C]

| Part of the file | FlexQTL fixture: 9 founders without data, 42 loci, 42 IBD positions | `binko_ibd.ped`: 2 dummy founders, 11 loci, 3 IBD positions |
|---|---|---|
| Pedigree table | 9 rows: both parents `-`, `FACTOR0` 0, `-` in the two other columns | 2 rows: both parents `-`, `FACTOR0` 0, `-` in the three other columns (no row in files written before commit `955aefa`) |
| `ALLELES` sections | A row in every section: 378 of 378 (9 × 42). Every one is `- 5    - 5`: both alleles unknown, code 5 | No row: 0 of 22 (2 × 11) |
| `FOUNDERALLELES` lines | `-` for both of the founder's entries on every line: 756 of 756 entries (9 × 42 × 2) | An allele name for every entry: 44 of 44 (2 × 11 × 2), the allele most often assigned in the sampled states |
| `IBDPOSITION` sections | A row in every section: 378 of 378 (9 × 42). Every one has `1.0` on the founder's own odd-numbered allele in the first half, `1.0` on its even-numbered allele in the second half, and `0` everywhere else: 378 of 378 | No row: 0 of 6 (2 × 3) |
| The homologue an offspring inherits from the founder | 378 homologues (9 offspring × 42 positions): all the probability lies on the founder's two alleles (378 of 378); the two values are `0.50` and `0.50` in 371 and `0.49` and `0.51` in 7 | 6 homologues (2 offspring × 3 positions): all the probability lies on the founder's two alleles (6 of 6); the first value ranges from 0.4975 to 0.52, the two always summing to 1 |

Examples from the FlexQTL fixture (the first founder without data, `DUMMY_G1_007_M`, founder 1, at the locus M1_001
and at position 0.000 of group 1; the IBD row is shown by its nonzero values):

```
DUMMY_G1_007_M       -                    -                                0            -            -
DUMMY_G1_007_M          - 5    - 5
DUMMY_G1_007_M   first half: [1] 1.0        second half: [2] 1.0
```

So the two programs agree on the pedigree row (Binko from commit `955aefa` on) and on what the offspring's rows
hold. They differ in three places: FlexQTL writes an `ALLELES` row and an `IBDPOSITION` row for the founder, and
Binko writes neither; and FlexQTL leaves the founder's `FOUNDERALLELES` entries unknown where Binko fills them from
its sampled states. The rows FlexQTL writes carry no information beyond the pedigree table: the genotype is unknown
with code 5, and the probabilities are the ones every founder has by definition (5.5). A reader can supply them
itself for a founder that has no row.

## 6. Every difference between FlexQTL's files and Binko's

"Legacy" is `Markers.write_pedimap`; "IBD" is `IBD.write_pedimap_ibd` as Binko's IBD mode calls it; "QTL run" is
`Views.write_pedimap`, which writes through the IBD writer and differs from it only where the table says so. The
Binko column describes commit `955aefa`; where an older Binko file differs, the row says so. Binko's legacy writer,
given FlexQTL's own phases and classes, reproduces every line of FlexQTL's file that is not a comment, byte for byte
and at the same line number, from the `POPULATION` line on. [O 7.4][W: its test on the reference runs] For a file
without IBD parts, rows 1 to 3, 5, 6, 8, 9, 15 to 18 and 26 apply.

| # | Item | FlexQTL 0.99130 | Binko | What a reader must do |
|---|---|---|---|---|
| 1 | First line | `; Output from FlexQTL software for visualisation by Pedimap software` | `; Pedimap data file written by Binko.jl <version> (format: …; not written by FlexQTL)`; FlexQTL's line in files written before 2026-11-19 | Skip comment lines; never require a particular head (2.6). |
| 2 | Contact lines | Three comment lines: an introduction, and a name with an e-mail address for the author of Pedimap and for the author of FlexQTL (one placeholder line in the fixture, 2.6) | None (the legacy writer wrote them before 2026-11-19) | Skip. |
| 3 | `generated by:`, `generated at:` | Version and date of FlexQTL; date of the run | The caller's text; a date, a free text, or empty | Skip; do not parse a date. |
| 4 | Further head comments | None | IBD: two lines on the founder alleles and the anchor rule. QTL run: three more on the origin of the probabilities | Skip. |
| 5 | An individual with one unknown parent | Cannot occur (FlexQTL refuses the input) | The parent column names a dummy founder `DUMMY_<name>_F` or `_M`, which has a pedigree row of its own (both parents `-`, `FACTOR0` 0, `-` elsewhere) immediately before its offspring. Files written before commit `955aefa`: the same name in the parent column, and no row for it | Read the dummy founder as a founder without data. For the older files, accept a parent without a row as one (3.2). |
| 6 | A founder without data in the `ALLELES` and `IBDPOSITION` sections | A row in every section, where the input listed the founder: `- 5    - 5` in each `ALLELES` section (378 of 378 in the fixture) and, in each `IBDPOSITION` section, probability 1 on its own two alleles (378 of 378) | No row for a dummy founder in either kind of section (0 of 22 and 0 of 6 in `binko_ibd.ped`) | Do not expect every individual of the table in these sections; for a founder without a row, the genotype is unknown and the probabilities are 1 on its own alleles (5.9). |
| 7 | Order of the founders behind `NALLELES` | The table's founder rows in order | The same. Files written before commit `955aefa`: the same order, the dummy founder having no row but taking its place immediately before its offspring | Take the founder rows in order; for the older files reconstruct as in 5.2. Check `NALLELES` = 2 × founders. |
| 8 | Columns after `FACTOR0` | `Gwrite` and the traits, in the files of the sources | Every nuisance-factor column of the data file, then the traits | Take the columns from the caption; do not assume how many are factors (section 8, point 5). |
| 9 | `ALLELENAMES` order | "Sorted"; order of integer names not known | Sorted as character strings (`102 110 98`) | Treat as a set. |
| 10 | `FOUNDERALLELES` field layout | Each entry right-aligned in 5 characters; the line ends with a blank | A blank and the entry right-aligned in 3 characters; no blank at the end | Split on white space. |
| 11 | `FOUNDERALLELES` of a founder without data | `-` | An allele name (the most frequent in the sampled states); `-` only if never assigned. QTL run: `-` for every founder on a linkage group without a tracked locus | Accept `-` and names alike. |
| 12 | Smaller allele of the anchor rule | `A` before `G`, `1` before `3`; no case with integers of different lengths observed | Numeric when all names of the locus are integers, otherwise as strings | Nothing: the labels are read, not derived. |
| 13 | Anchor marker | The founder's first heterozygous marker of the group in every file observed, under `anchorMarker` 0 and 1 | As the setting says: 0 first heterozygous marker of the group, 1 the one nearest the position (default 0 in the IBD mode, 1 in the QTL-run writer); stated in the head | Nothing; do not assume labels agree between files, between groups, or (Binko, setting 1) between positions. |
| 14 | A founder's `ALLELES` row against its `FOUNDERALLELES` entries | The same ordered pair wherever both are known | Not tied: in `binko_ibd.ped`, of 66 founder genotypes, 54 the same pair, 11 the pair in the other order, 1 another pair | Take founder alleles from `FOUNDERALLELES`, never from the founder's `ALLELES` row. |
| 15 | Alleles in `ALLELES` rows | The run's most probable phase; raw alleles for codes 5 and 7; `-` for 11 and 12 | Legacy: the same rules with Binko's phases. IBD: the most probable ordered pair of the IBD run; it can differ from the observed genotype even with code 0. QTL run: the observed genotype in the data file's allele order (not phased); a half-missing genotype keeps its one allele | Do not assume the two alleles are phased unless the writer is known. |
| 16 | Indicator codes in use | 0 to 9, 11, 12 | Legacy: 0 to 8, 11, 12. IBD: 0, 1, 5. QTL run: 0, 5 | Accept any integer (4.2). |
| 17 | Meaning of code 0 | Observed and consistent; the alleles are the observed ones (2,717 of 2,717 rows of the fixture hold the data file's two alleles) | Legacy: the same. IBD and QTL run: "the genotype is in the data"; no consistency check was made | Read code 0 as "observed", and "checked" only for FlexQTL and Binko's legacy writer. |
| 18 | End of file | No line end after the last row | Legacy: none. IBD and QTL run: a line feed | Accept both. |
| 19 | `IBDPOSITIONS` numbers | 3 decimals, 11-character fields, blank at the end | 4 decimals, single blanks | Parse as numbers. |
| 20 | `IBDPOSITION` line | Position right-aligned, two tabs, `; Linkage Group <name>` | `IBDPOSITION <position> ; LG <name>` | Read the position; take the group from the order (5.5). |
| 21 | Comment rows of an `IBDPOSITION` section | Six: half labels, founder numbers, allele numbers, position and marker, founder alleles at the marker. The founders are numbered, not named | Two: the founders' names, separated by single blanks without alignment, and the allele numbers. Files written before commit `955aefa`: each name padded to ten characters, longer names touching their neighbors | Skip; the founders' names follow from the pedigree table (5.2). |
| 22 | Probability format | 2 decimals, 5-character fields, exact 0 as `0` and exact 1 as `1.0` | 4 decimals by default, 10-character fields, three more blanks between the halves | Parse as numbers; expect 1 + 2 × `NALLELES` fields. |
| 23 | Sum of a homologue as printed | 1 within the rounding: 0.98 to 1.02 observed | Exactly 1 | Use the tolerance of 5.6. |
| 24 | What the probabilities are | Posterior of a fixed-position run, at the positions asked for | IBD: the same kind of run. QTL run: shares of a QTL run's stored draws, at the loci that run tracked | Nothing for parsing; the head of the QTL-run file says so. |
| 25 | Line length of an IBD row | About 10 × `NALLELES` + 30 characters | About 20 × `NALLELES` + 27 | Do not limit the line length. |
| 26 | The `FACTOR0` note (four comment lines before `PEDIGREE`) and the code legend (nineteen comment lines before the first `ALLELES` section) | FlexQTL's wording | Binko's own words, in as many lines, at the same places (4.1, 4.2). Files written before commit `955aefa`: FlexQTL's wording | Skip; never match the text of a comment. |

Sources of the rows: 1 to 4 [O 7.4][W][F]; 5 to 7 [O 7.4][W][F][C]; 8 [O 7.4][W]; 9 [O 7.4][W][C]; 10 and 11
[F][W][C]; 12 and 13 [D D15][B (b)][W][F]; 14 [F][C]; 15 to 17 [O 7.4][V 10][W][F]; 18 to 23 [F][W][C]; 24
[V 7.2][V 10]; 25 [F][W]; 26 [F][W][C].

## 7. What a reader should tolerate and what it should reject

### 7.1 Tolerate

- Any comment lines anywhere, and a comment at the end of any line; a missing or unknown head (2.6).
- Blank lines anywhere; blanks and tabs in any number between fields and at the end of a line; a last line with or
  without a line end. A carriage return before the line feed, if a file has passed through another system (none of
  the sources has one).
- The third field `(index)` of a `LOCUS` line, present or absent.
- Fields wider than their usual column.
- An individual of the pedigree table that has no row in the `ALLELES` sections or in the `IBDPOSITION` sections:
  Binko's dummy founders (3.2, 5.9). Its genotypes are unknown; if it is a founder, its probabilities are 1 on its
  own two founder alleles.
- A parent name without a row, in any number: Binko's files written before commit `955aefa` (3.2). It is a founder
  without data.
- An `IBDPOSITIONS` line with no position, and a linkage group without positions.
- Any non-negative integer as an indicator code; the two codes of a row need not be compared.
- `0`, `1.0` and any number of decimals in a probability; a homologue's sum within the tolerance of 5.6.
- An entry `-` on a `FOUNDERALLELES` line and in an `ALLELES` row; an allele `null`.
- Keywords in any letter case, as Binko's reader does.
- A file without any `ALLELES` section for some locus, if the reader's purpose allows it: both programs always write
  a section for every locus, so this would be a file from another source; the genotypes of that locus are then
  unknown.

### 7.2 Reject, with the line number

- A pedigree row whose number of fields differs from the caption's; two rows for one individual; an individual that
  is its own ancestor.
- A `MAP` row that is not a name and a number; a `LOCUS` whose name is not in the group's `MAP`; a locus that occurs
  twice.
- An `ALLELES` section of a locus that is not in the map; an `ALLELES` or `IBDPOSITION` row of an individual that is
  not in the pedigree table; an `ALLELES` row that does not have five fields; a code that is not an integer.
- An allele that is neither on the locus's `ALLELENAMES` line, nor the `CONFIRMEDNULL` name, nor an `UNKNOWN`
  string.
- `FOUNDERALLELES` or `IBDPOSITION` in a file without `NALLELES`; a `FOUNDERALLELES` line whose number of entries is
  not `NALLELES`; an `IBDPOSITION` row whose number of values is not 2 × `NALLELES`.
- `NALLELES` different from twice the number of founders of the pedigree table (parents without a row included).
- An individual that is not a founder and has no row in an `IBDPOSITION` section of a file with IBD sections: its
  probabilities cannot be supplied. Neither program writes such a file.
- A number of `IBDPOSITION` sections different from the number of positions on the `IBDPOSITIONS` lines, or a
  section whose position is not the one the lines give at its rank.
- A probability that is not a number or lies outside 0 to 1; a homologue whose sum is outside the tolerance. A
  reader may prefer to warn rather than reject for the sum.
- A value of `PLOIDY` other than 2: neither program writes one, and nothing here describes such a file.

### 7.3 Settings lines that are absent

Both programs always write the five settings lines, so no file of the sources lacks one. The project lead's sentence
(2.6) says such lines may be omitted. What values hold then is a matter of Pedimap's own documentation, which this
document does not draw on (section 8, point 1). The reference reader falls back on the values both programs always
write: `* -`, `$`, `null`, 2, and no IBD parts without `NALLELES`.

## 8. Open points

Points the sources could not settle. Each needs either Pedimap's own documentation or a further FlexQTL run.

1. **Defaults of absent settings lines, the order of settings lines, and anything Pedimap accepts that these two
   writers never produce** (other parent captions, genotype rows without codes, other ploidy, quoted names, decimal
   commas). Out of scope by the brief; a reader for Pedimap files from other sources needs Pedimap's documentation.
2. **Rows for Binko's dummy founders in the `ALLELES` and `IBDPOSITION` sections.** From commit `955aefa` on a dummy
   founder has a pedigree row, and the `;founders` comment row separates its names, so the founders behind the
   founder alleles follow from the table in both programs' files. Binko still writes no row for a dummy founder in
   the `ALLELES` and `IBDPOSITION` sections, where FlexQTL writes one for a founder without data (5.9: `- 5    - 5`,
   and probability 1 on the founder's own alleles). The project lead decided on 2026-11-20 that Binko will write
   those rows too, as FlexQTL does, so that the file is uniform: from Binko 1.0.1 on. The files of Binko 1.0.0 are
   without them. A reader that follows 7.1 accepts both.
   The rule for Binko's older files (a parent without a row placed before its offspring, 5.2) follows from Binko's
   code and is checked by the self-check on `binko_ibd.ped` with its two dummy rows removed, a pedigree in which both
   dummy founders come after every other founder. It is not tested on a pedigree in which a founder's row comes after
   a dummy founder's offspring.
3. **`NULLHOMOZ` (`$`).** No file of the sources holds `$` or `null` in a genotype row, and the sources do not say
   in which rows FlexQTL writes `$`. [O 7.4] states only that `null` is written for a confirmed null allele.
4. **`ALLELENAMES` with integer names in FlexQTL.** FlexQTL's order ("sorted") was determined on letter names;
   whether `98` comes before `102` in its files is not known. The same doubt applies to the "smaller allele" of the
   anchor rule for integers of different lengths: Binko compares numerically, and FlexQTL was observed only with
   `A`/`G` and `1`/`3`.
5. **FlexQTL's columns after `FACTOR0` when the data file has several nuisance factors.** Its files in the sources
   have one (`Gwrite`). Binko writes all of them, and its fixtures have two (`Gwrite`, `Block`).
6. **Names with blanks or semicolons.** Neither writer quotes; such a file would not be readable by the rules here.
   No source shows what FlexQTL does with such a name.
7. **Codes 3, 4, 6, 8, 9 and 12** are in no file from simulated data, so what a row of such a code looks like is
   known from the rule of [O 7.4] only. What produces code 9 is not stated.
8. **`anchorMarker 1` in FlexQTL.** The setting made no visible difference in the files observed (5.3); whether it
   ever changes the labels is not known.
9. **A legacy file written by FlexQTL from simulated data** was not among the sources, so no FlexQTL legacy fixture
   exists here. The route B fixture contains every legacy part.
10. **The second allele order claim of 3.4** (first allele on the first homologue in FlexQTL's `ALLELES` rows) is
    observed on 293 and 55 decidable genotypes and stated by no specification.
11. **Other FlexQTL versions.** Everything observed is version 0.99130. [O 15] states that the 2012 version writes
    the same sections with a legend that lacks codes 11 and 12; no route B file of that version is known to the
    Binko project.

## Appendix: the reference reader

`make_fixtures.jl` contains a reader of about 190 lines, `read_pedimap`, that follows sections 2 to 5 and the reject
list of 7.2 (the sums of 5.6 are checked by the script's self-check, not by the reader), and returns the content in
the layout of the expected JSON files. It reads Binko's files of both forms: with a pedigree row for each dummy
founder, and without (the parents without a row are then listed in the content's `parents_without_row`). It is the reader behind the FlexQTL
fixture's expected JSON and behind the self-check, and it may serve as a second statement of the rules. In outline:

1. For each line: cut at the first `;`, trim, skip if empty, split on white space.
2. If the line contains `=` and the text before it is a settings keyword, store the setting.
3. Otherwise act on the first field: `PEDIGREE` (the next line is the caption), `LINKAGEGROUP`, `MAP`, `LOCUS`,
   `ALLELENAMES`, `FOUNDERALLELES`, `IBDPOSITIONS`, `ALLELES`, `IBDPOSITION`.
4. Otherwise the line is a row of the section that is open: a pedigree row, a map row, a genotype row or a
   probability row.
5. At the end: replace the `UNKNOWN` strings by "unknown"; find the founders (5.2); assign the `IBDPOSITION` sections
   to the linkage groups by their order (5.5); check the counts.

Because a keyword is recognized before a row, an individual or a locus whose name is itself a keyword (`MAP`,
`ALLELES`, …) would be misread; no file of the sources has such a name.
