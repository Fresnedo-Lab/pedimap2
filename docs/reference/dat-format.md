# Pedimap 2 `.dat` Format — Parser Specification

> **Status:** authoritative. This document defines how a conforming Pedimap 2
> parser MUST interpret a `.dat` file. Where the wording says MUST / MUST NOT /
> MAY, it is normative.
>
> **Source attribution.** Format derived from Pedimap 1.x (Voorrips, Bink &
> van de Weg 2012) and its accompanying manual. This specification is original
> documentation written for Pedimap 2; it does not reproduce text from the
> original manual, which is copyrighted by Wageningen UR.
>
> **Files written by FlexQTL and Binko.jl.** FlexQTL 0.99130 and Binko.jl
> write this format with a few additions of their own (`CONFIRMEDNULL`,
> `FACTOR0`, an index on `LOCUS` lines, founders without data). How they write
> it, and what a reader accepts and rejects, is specified in
> [`flexqtl-binko-pedimap/`](flexqtl-binko-pedimap/README.md) — cited below as
> the *reader spec* (`pedimap-input-file-reader-spec.md`) — with its test files
> in `backend/tests/fixtures/flexqtl_binko/`. Pedimap 2 follows it; the
> sections below say where.

---

## 1. Lexical structure

A `.dat` file is plain ASCII/UTF-8 text, read line by line.

### 1.1 Comments

A semicolon (`;`) begins a comment that runs to the end of the line. Comments
may appear **anywhere**, including at the end of a line that carries data:

```
NALLELES   = 8             ; for 8 founder-alleles per locus
GoldenD    *   *   Yellow  ; a founder
```

The parser MUST strip everything from the first unquoted `;` to end-of-line
**before** tokenizing the remainder. A `;` inside a double-quoted name is part
of the name and does not start a comment (see §3.5).

### 1.2 Tokens and whitespace

Within a line, tokens are separated by runs of whitespace (spaces and/or tabs).
Leading and trailing whitespace is insignificant. Blank lines (empty after
comment stripping) are ignored and MAY appear freely between sections. Lines
end with LF, CRLF or CR, the last line may have no line end, and a line may be
of any length. Columns are never read by position: a field wider than its
neighbors' alignment just pushes the rest of the line along.

### 1.2.1 Errors name the line

A file that breaks a rule of this document is rejected with a message that
starts with the number of the offending line (`Line 466: …`). Problems that do
not make the data wrong are reported as **warnings** instead and the file
loads (§3.1.1, §3.4, §7.2); the app shows them above the chart.

### 1.3 Keywords

Section and header keywords (`POPULATION`, `PEDIGREE`, `NALLELES`,
`LINKAGEGROUP`, …) are matched **case-insensitively**. Note this is the
opposite of individual and locus **names**, which are case-sensitive (§3.4).

---

## 2. Header keywords

Header assignments appear before the `PEDIGREE` section. Each is of the form
`KEYWORD = value` (whitespace around `=` optional). All are optional; each has
a defined default.

| Keyword | Default | Meaning |
|---|---|---|
| `POPULATION` | the file's base name | Display name for the pedigree. |
| `UNKNOWN` | `-` | Symbol(s) marking an unknown/absent parent. |
| `NULLHOMOZ` | `$` | Symbol for a null (silent) homozygous marker allele. |
| `CONFIRMEDNULL` | `null` | Name under which a confirmed null allele is written in `ALLELES` rows (FlexQTL, Binko; reader spec 3.1). |
| `NALLELES` | `0` | Number of founder alleles per locus for IBD data. `0` or absent ⇒ **no IBD data** in the file. |
| `PLOIDY` | `2` | Ploidy level of the population. |

A line MAY also be written without spaces (`PLOIDY=2`) or without the `=`.
`NALLELES` and `PLOIDY` MUST be whole numbers.

### 2.1 `UNKNOWN` — multiple symbols

`UNKNOWN` MAY list several symbols separated by whitespace; **any** of them, when
it appears in a parent column, denotes an unknown parent. The **first** symbol is
the one used when the application renders or re-exports an unknown parent.

```
UNKNOWN = * -      ; both * and - mean "unknown"; * is used for display
```

Here both `*` and `-` are accepted on input; `*` is canonical for output.

### 2.2 `NALLELES` gates IBD

`NALLELES` is the single switch that says whether the file carries
identity-by-descent (IBD) probability data. If it is absent or `0`, the file
has no IBD data, and an `IBDPOSITION` section or a `FOUNDERALLELES` line in it
is an error (an `IBDPOSITIONS` line is ignored). If it is a positive integer
*N*, every IBD section provides exactly *N* probabilities per homologue (§7).

---

## 3. Pedigree section

The section begins with a line whose first token is `PEDIGREE`. The **next**
non-blank, non-comment line is the **caption** (column header). Data rows
follow until the next section keyword or end of file.

### 3.1 Caption line

The caption defines the columns. Its first token MUST be `NAME`. It is followed
by exactly two **parent columns**, and then zero or more **trait names**, one
per remaining column:

```
NAME         FEMALE       MALE      Color     Length
```

- Column 1: individual name.
- Columns 2–3: the two parents.
- Columns 4…: trait columns (`Color`, `Length`, …). Trait names are taken
  verbatim from the caption and are case-sensitive.

A pedigree with no trait columns is valid (caption is just `NAME` + two parent
columns). Every data row MUST have exactly as many fields as the caption; use
an `UNKNOWN` symbol for a missing value.

### 3.1.1 `FACTOR0`

A column named `FACTOR0` (written by FlexQTL and Binko after the parents) is
**not a trait**: it gives each individual's place in the pedigree — 0 founder,
1 with known parents and offspring, 2 with known parents and no offspring
(reader spec 4.1). Pedimap 2 keeps it as read, does not offer it for
coloring, and warns if a value disagrees with the pedigree. A `.dat` export
writes the column again, computed from the pedigree it writes.

### 3.2 Parent-column aliases

The two parent columns MAY be labeled with any of these alias pairs. All are
valid and equivalent:

| Column A | Column B |
|---|---|
| `FEMALE` | `MALE` |
| `MOTHER` | `FATHER` |
| `PARENT1` | `PARENT2` |

### 3.3 Parent order is NOT fixed — detect it

Disciplines order the sexes differently: plant genetics conventionally lists the
**female (seed) parent first**, whereas animal and human genetics usually list
the **male (sire) parent first**. The parser MUST determine which physical column
is female and which is male **from the caption labels**, and MUST NOT assume a
fixed order.

- `FEMALE … MALE`, `MOTHER … FATHER` ⇒ column 2 = female, column 3 = male.
- If the file reverses them (`MALE … FEMALE`, `FATHER … MOTHER`) ⇒ column 2 =
  male, column 3 = female.
- For the neutral `PARENT1`/`PARENT2` pair there is no sex information; the
  parser MUST record the two parents as "parent 1" and "parent 2" without
  asserting a sex, and downstream code MUST NOT assume parent 1 is female.

### 3.4 Names are case-sensitive and must match exactly

Individual names are **case-sensitive** and MUST match byte-for-byte wherever
they are referenced — in the parent columns, and in every marker/IBD section.
`Elstar`, `elstar`, and `ELSTAR` are three different individuals.

A parent name that has no row of its own (and is not an `UNKNOWN` symbol or a
uniparental keyword) is read as a **founder without data**, placed just before
the first row that names it, and reported in a warning so that a misspelled
name is noticed: the warning names the closest individual of the pedigree when
one is within a small edit distance, ignoring case (1 for names of up to five
characters, 2 for longer ones). Binko wrote its dummy founders this way before its commit
`955aefa` (reader spec 3.2). Such a parent counts as a founder for the IBD data
(§7.6), and an `ALLELES` or IBD row may name it. A `.dat` export writes a row
for it.

### 3.5 Names containing spaces must be quoted — everywhere

A name that contains a space MUST be enclosed in double quotes, and MUST be
quoted **consistently in every section** it appears in (pedigree, marker
`ALLELES`, IBD tables):

```
"Golden Delicious"   *   *   Yellow   20.1
```

Inside a quoted name, `;` and `/` are literal characters, not a comment or
delimiter.

### 3.6 Unknown parents

A parent token equal to any `UNKNOWN` symbol (default `-`) means the parent is
unknown. An individual with both parents unknown is a **founder**.

### 3.7 Uniparental descent keywords

When an individual derives from a **single** parent, the second parent column
carries a procreation keyword instead of a name. These keywords are **not**
individual names and MUST NOT be looked up as such — model each as an explicit
**procreation-type field on the parent→child relationship**, so the renderer can
draw one connector of the appropriate kind rather than inventing a phantom second
parent.

| Keyword | Procreation type |
|---|---|
| `*SELF` | Selfing (self-pollination). |
| `*DH` | Doubled-haploid induction. |
| `*MUT` | Mutant derived from the single parent. |
| `*VP` | Vegetative propagation / clone. |

Additional rule for selfing: if **both** parent columns name the **same**
individual, the relationship is a self and MUST be modeled identically to
`*SELF` (single connector, procreation type = selfing).

The remaining (named) parent column identifies the single parent; the keyword
column identifies how the offspring was produced from it.

---

## 4. Trait-type inference

Each trait column is classified as **discrete** or **continuous** by inspecting
its non-missing values across all individuals. Apply **exactly** this rule:

> A trait is **DISCRETE** if
> **(a)** every non-missing value is a single character,
> **OR (b)** at least one non-missing value is not a number.
>
> Otherwise the trait is **CONTINUOUS**.

Missing values (the `UNKNOWN` symbols) are ignored for the purpose of this
classification.

### 4.1 Consequences (these MUST hold)

| Value set (non-missing) | Class | Why |
|---|---|---|
| `1 2 … 9` | discrete | every value is a single character (rule a) |
| `A B AB O` | discrete | some value is not a number (rule b) |
| `Red Green Yellow` | discrete | not numbers (rule b) |
| `1 … 50` | **continuous** | `10`, `50` are numbers of length > 1, and all values are numeric ⇒ neither (a) nor (b) holds |
| `-2 -1 0 1 2` | **continuous** | `-2` is a number two characters long; all numeric |
| `2.5 … 7.4` | **continuous** | multi-character numbers, all numeric |

> **Do NOT classify a trait purely on float-parseability.** The value `9`
> parses as a float but is discrete; the value `50` parses as a float and is
> continuous. The distinguishing test is the single-character / non-numeric
> rule above, not "does `float()` succeed."

### 4.2 Definition of "single character" and "number"

- **Single character**: the value's string length is exactly 1 (after quote and
  whitespace stripping).
- **Number**: the value parses as an integer or decimal real (optional leading
  sign, optional single decimal point). Anything else (letters, mixed
  alphanumerics, multiple dots) is not a number.

### 4.3 Declared trait types (Pedimap 2 extension)

Inference looks only at the values present in the file, so a file that holds
part of a population can infer a different type than the full population did.
Example: a discrete trait with values `10`, `20` and `X1` loses its only
non-numeric value when the `X1` individual is left out, and `10`, `20` alone
infer as continuous.

To prevent this, Pedimap 2 writes one full-line comment per trait when it
exports a `.dat` file:

```
; PEDIMAP2 TRAITTYPE <trait name> discrete|continuous
```

- `<trait name>` is quoted when it contains spaces (§3.5). The directive
  keywords and the type are case-insensitive.
- When a directive names a trait column, its type is used instead of
  inference. If a trait declared `continuous` has a non-numeric value, the
  declaration cannot apply and inference decides (§4).
- Directives for names that are not trait columns are ignored, and files
  without directives are inferred as before.
- Because it is a comment (§1.1), readers that do not know the directive,
  including Pedimap 1.x, ignore it.

---

## 5. Topological ordering

### 5.1 Any input order

Individuals MAY be listed in the pedigree in any order. A child MAY appear
before its parents. The parser MUST build the full set of individuals first,
then order them.

### 5.2 Parents before children

The parser MUST produce an ordering in which **every individual appears after
both of its (known) parents**. Founders and the single/known parent of a
uniparental relationship are ordered before their descendants accordingly.

### 5.3 Stable sib order

The sort MUST be **stable with respect to file order** for individuals that are
not otherwise constrained. In particular, members of the same full-sib family
(same two parents) MUST retain their **relative order of appearance in the
file**. A conforming implementation SHOULD use a stable topological sort keyed on
first-appearance index.

### 5.4 Cycles are a hard error

If the parent relation contains a cycle — two or more individuals that are
(directly or transitively) each other's ancestor — the parser MUST raise a clear
error. The error message MUST **name every individual participating in the
cycle**, e.g.:

```
Error: circular pedigree — the following individuals form an ancestry cycle:
  Elise -> Cox -> Septer -> Elise
```

The parser MUST NOT silently drop an edge or partially order a cyclic pedigree.

---

## 6. Marker / linkage-group sections

A locus/marker block is introduced by `LINKAGEGROUP <name>` and MAY contain
`MAP`, `LOCUS`, `ALLELENAMES`, and `FOUNDERALLELES` statements describing the
observed marker data, plus an `IBDPOSITIONS` statement (§7) when IBD data is
present. A file MAY contain observed marker data, IBD data, both, or neither
(§8).

### 6.1 Marker color codes

Marker allele color codes `0`–`9` each map to a **distinct default color**. Any
code **greater than 9** is rendered **gray**. Implementations MUST reserve gray
for the out-of-range case so that codes 0–9 remain visually unambiguous.

A code is any non-negative integer and is kept as read. In FlexQTL's and
Binko's files it states how the genotype was obtained (observed, filled in,
judged an error, …; codes 0–9, 11 and 12, reader spec 4.2).

### 6.2 Linkage-group annotation delimiter — accept `;` **and** `/`

Some statements carry a trailing linkage-group annotation. The delimiter before
the annotation is normally a comment `;`:

```
ALLELES SSR1 ; LG A
IBDPOSITION  0 ; LG A
```

However, the original Pedimap tolerated a `/` in this position, and at least one
shipped example relies on it:

```
IBDPOSITION  0 / LG C      ; from Example.dat — a typo the original accepted
```

A conforming Pedimap 2 parser MUST accept **both** `;` and `/` as the delimiter
introducing the linkage-group annotation on these statements, and treat the text
after it (`LG C`) as the annotation. This is a deliberate bug-for-bug
compatibility allowance; new files SHOULD use `;`.

The annotation is **not** what assigns an `IBDPOSITION` section to its linkage
group: the order of the sections does (§7.5). The annotation is read only as a
cross-check, in the forms `LG <name>` and `Linkage Group <name>` (FlexQTL); if
it names a different group, a warning says so and the order still decides.
Other text is ignored.

### 6.3 `MAP`, `LOCUS`, `ALLELENAMES`, `FOUNDERALLELES`

- A `MAP` row is a locus name and a position (a number); a locus MUST NOT
  appear twice in the map.
- `LOCUS <name>` MUST name a locus of the current group's `MAP`, once. It MAY
  carry the locus's index in parentheses as a third field, `LOCUS M3_001 (9)`
  (FlexQTL, Binko); the index is kept and written back on export.
- `FOUNDERALLELES` requires `NALLELES` and lists exactly `NALLELES` names
  (`-` for unknown).
- A reader accepts a locus without a `LOCUS` line, and a `LOCUS` without an
  `ALLELENAMES` line (or with an empty one: no names, so no restriction,
  §6.4). Pedimap 1.x requires both for every locus of the map, so a `.dat`
  export writes a `LOCUS` line with `ALLELENAMES` for each. Data without
  allele names (the demo data, JSON files) gets them from its alleles: the
  alleles observed at the locus and its founder alleles, without the
  `UNKNOWN`, `NULLHOMOZ` and `CONFIRMEDNULL` symbols, numbers in numeric
  order before other names. A locus without data gets an empty
  `ALLELENAMES` line.

### 6.4 `ALLELES` rows

Each row is the individual's name followed by `PLOIDY` pairs of an allele and
its code (§6.1) — five fields for a diploid. The alleles are kept in the order
written. The individual MUST be in the pedigree (or be a parent without a row,
§3.4). When the locus has an `ALLELENAMES` line, every allele MUST be on it or
be a symbol the file declares: one of its `UNKNOWN` strings (`-` when there is
no `UNKNOWN` line), or the symbol of its `NULLHOMOZ` or `CONFIRMEDNULL` line
when it has one. An
individual without a row in a section has unknown genotypes there, and a
section MAY have no rows at all. A locus MAY have an `ALLELES` section
without a `MAP` entry. Pedimap 1.x requires an `ALLELES` section for every
locus of the map, so a `.dat` export writes one for each, without rows
where no exported individual has data there.

---

## 7. IBD sections

Present only when `NALLELES` is a positive integer *N* (§2.2); an
`IBDPOSITION` section in a file without it is an error, as is one in a file
whose `PLOIDY` is not 2 (IBD data for other ploidies is not supported yet;
their pedigrees and markers are). Each IBD section
is tied to one linkage group and one position via an `IBDPOSITIONS` /
`IBDPOSITION` statement, and provides IBD founder-allele probabilities for every
individual.

### 7.1 Layout per individual

For each individual the section gives, in order:

1. *N* probabilities for the **first homologue**, then
2. *N* probabilities for the **second homologue**,
3. and, for ploidy > 2, a further set of *N* per additional homologue
   (`PLOIDY` sets of *N* values in total). Pedimap 2 does not read IBD data
   for a ploidy other than 2 yet.

Example (`NALLELES = 8`, `PLOIDY = 2`) — 8 maternal then 8 paternal values:

```
;               maternal IBD probabilities              paternal IBD probabilities
;allele number: 1   2   3   4   5   6   7   8           1   2   3   4   5   6   7   8
81015-045       0.22 0  0.78 0   0   0   0   0          0   0   0   0   0  1.0  0   0
```

### 7.2 Values, and each homologue's sum

Missing data is **not permitted** in an IBD section: a row MUST have exactly
`PLOIDY` × *N* values, each a number from 0 to 1, written with any number of
decimals (`0`, `1.0`, `0.50`, `0.4975`). Otherwise the file is rejected.

Within each homologue the *N* probabilities sum to 1, within the rounding of
the printed values (reader spec 5.6):

    |sum − 1|  ≤  m × 0.5 × 10^(−d) + 1e-9

where *d* is the largest number of decimals among the file's probabilities and
*m* the number of the homologue's values not written as a bare `0`. A homologue
outside this bound is reported in a **warning**; the file loads and the values
are kept as read (not rescaled). A `.dat` export writes every probability as
it was read — an exact `0` or `1.0` stays so, as does a rounded `0.00` — so the
bound is the same when the export is read back.

### 7.3 Completeness and order

- **Every individual that is not a founder** MUST appear in **every** IBD
  section; a missing one is an error naming the individual and the section.
- A **founder** without a row (Binko writes none for its dummy founders,
  reader spec 5.9) gets the row every founder has: probability 1 on its own
  founder alleles (§7.6). A `.dat` export of the whole population leaves these
  supplied rows out again.
- Individuals MAY be listed in **any order** within a section; the parser keys
  rows by name (case-sensitive, §3.4), not by position.

### 7.4 IBD data in exported subsets

When Pedimap 2 exports part of a population (for example a subpopulation),
it keeps the IBD model of the **source population** unchanged, and says so
with the full-line comment

```
; PEDIMAP2 IBDFOUNDERS SOURCE
```

A file with this comment — or a subset written by Pedimap 2.2.2 or earlier,
recognized by its head (`; Exported by Pedimap 2` followed by
`; Subpopulation of: …`) — is exempt from the founder-allele rules of §7.6, and
every individual in it MUST have a row in every IBD section. In detail:

- `NALLELES`, every `FOUNDERALLELES` list and every `IBDPOSITIONS` list are
  written exactly as in the source.
- Each exported individual's IBD rows are written unchanged: the same
  *N* probabilities per homologue, still summing to 1.

The founder alleles are therefore those of the source population's founders.
Those founders need not be in the exported file — a subset of descendants
usually leaves them out — so a file's IBD probabilities **may refer to founder
alleles whose founders are not present in it**.

- **Pedimap 2** reads such files. §7.3 still holds: every individual *in the
  file* appears in every IBD section. Founder alleles are identified by their
  position 1…*N*, not by founder name, and they keep their meaning.
- **Pedimap 1.x:** compatibility with such files is **untested**. If the
  original program expects the founder alleles to belong to founders listed
  in the pedigree, it may reject such a file or show it wrongly.

### 7.5 Which linkage group a section belongs to

The `IBDPOSITIONS` lines (one per linkage group, after its loci; it MAY list
no position) give the file's IBD positions in order. The **k-th
`IBDPOSITION` section belongs to the k-th position** of those lines taken in
file order, and its position MUST equal that one (reader spec 5.5). The
position alone does not identify a section — FlexQTL writes `0.000` once for
every group. The file is rejected if the number of sections differs from the
number of positions, if a section's position is not the one at its rank, or if
its annotation names another group (§6.2).

### 7.6 Founder alleles

The founder alleles are numbered 1…*N*, `PLOIDY` per founder: founder *f*
owns alleles 2*f* − 1 and 2*f*. *N* MUST equal 2 × the number
of founders, counting parents without a row (§3.4).

Which founder owns which alleles is read from the **founders' own rows**: a
founder's row has probability 1 on its first allele in the first homologue,
on its second allele in the second, and 0 elsewhere. In `Example.dat` the
founders' rows put GoldenD, IngridM, Jonathan and Cox on alleles 1–8 in that
order, although Cox is the first founder of the pedigree table. Founders
without a row take the remaining allele numbers in table order (in FlexQTL's
and Binko's files the two orders agree, reader spec 5.2). The file is rejected
if a founder's row is not of that form, if two founders claim the same
alleles, or if a founder's alleles differ between sections.

---

## 8. Valid subsets

All of the following are complete, valid files and MUST parse without error.

### 8.1 Pedigree only

A `PEDIGREE` section (with or without trait columns) and **no** linkage-group
sections at all. This is the minimal valid file.

### 8.2 Pedigree + observed alleles, no IBD

Marker data present, but **no** IBD data:

- `NALLELES` omitted or `0`,
- **no** `FOUNDERALLELES` and **no** `IBDPOSITIONS` statements,
- **no** IBD probability tables.

Linkage groups may still carry `MAP`, `LOCUS`, `ALLELENAMES`, and observed
`ALLELES` data.

### 8.3 Pedigree + IBD only, no observed alleles

IBD data present, but **no** observed marker genotypes:

- each linkage group contains **only** an `IBDPOSITIONS` statement (plus its IBD
  tables),
- **no** `MAP` and **no** `LOCUS` sections.

---

## 9. Worked reference (from `Example.dat`)

The bundled `backend/demo_data/Example.dat` is the canonical conformance
fixture. It exercises, in one file: multiple `UNKNOWN` symbols (`* -`),
`FEMALE`/`MALE` captions with plant (female-first) ordering, founders via `*`,
discrete traits (`Color`) and continuous traits (`Length`), three linkage groups
with `MAP`/`LOCUS`/`ALLELENAMES`/`FOUNDERALLELES`, IBD sections at
`NALLELES = 8`, the `; LG A` annotation form, and the `IBDPOSITION 0 / LG C`
slash-delimiter typo (§6.2). A parser that reads `Example.dat` correctly and
round-trips its pedigree, traits, and IBD tables satisfies the core of this
specification.

---

## 10. Conformance checklist

- [ ] `;` comments stripped anywhere, including end-of-line; `;`/`/` literal inside quoted names.
- [ ] Header defaults applied: `POPULATION`=filename, `UNKNOWN`=`-`, `NULLHOMOZ`=`$`, `NALLELES`=`0`, `PLOIDY`=`2`.
- [ ] `UNKNOWN` may list several symbols; first used for display; all accepted on input.
- [ ] `NALLELES` 0/absent ⇒ no IBD; positive *N* ⇒ *N* probabilities per homologue.
- [ ] Caption parsed for `NAME` + two parent columns + trait names.
- [ ] All parent aliases accepted: FEMALE/MALE, MOTHER/FATHER, PARENT1/PARENT2.
- [ ] Parent sex detected from caption; reversed order honored; PARENT1/2 carry no sex.
- [ ] `*SELF`, `*DH`, `*MUT`, `*VP` modeled as procreation-type on the relationship; equal parents ⇒ self.
- [ ] Names case-sensitive, matched exactly across sections; space-containing names quoted everywhere.
- [ ] Trait inference by the single-character / non-numeric rule — NOT by float-parseability.
- [ ] `; PEDIMAP2 TRAITTYPE` comments, when present, set a trait's type; otherwise inference (§4.3).
- [ ] Topological sort: parents before children; stable sib order; cycle error naming all members.
- [ ] Marker color codes 0–9 distinct; > 9 gray.
- [ ] Lines ended by LF, CRLF or CR; errors start with the line number; warnings do not stop loading.
- [ ] `FACTOR0` kept as metadata, checked against the pedigree, not a trait (§3.1.1).
- [ ] A parent without a row is a founder without data, with a warning naming the closest individual (§3.4).
- [ ] `MAP`, `LOCUS (index)`, `FOUNDERALLELES` and `ALLELES` rows checked; codes any non-negative integer (§6).
- [ ] An `ALLELES` section without rows, and an empty `ALLELENAMES` line, parse (§6.3–6.4).
- [ ] A `.dat` export writes `LOCUS` and `ALLELENAMES` for every locus of the map and an `ALLELES` section for every locus; missing allele names are taken from the alleles (§6.3–6.4).
- [ ] LG annotation delimiter accepts both `;` and `/`; the annotation only cross-checks the group, with a warning (§6.2).
- [ ] IBD sections assigned to groups by their order against the `IBDPOSITIONS` lines (§7.5).
- [ ] IBD: no missing data, values 0–1; sums within their rounding or a warning; every non-founder in every section; founders without a row supplied; any order (§7.2–7.3).
- [ ] IBD data only at `PLOIDY` 2; `NALLELES` = 2 × founders; founder alleles from the founders' own rows (§7.6).
- [ ] A `.dat` export writes IBD probabilities as read (`0`, `1.0`, `0.00`, …) (§7.2).
- [ ] Exported subsets keep the source's founder alleles, marked `; PEDIMAP2 IBDFOUNDERS SOURCE`; IBD rows may refer to founders not in the file (§7.4).
- [ ] All three valid subsets (§8.1–8.3) parse.
