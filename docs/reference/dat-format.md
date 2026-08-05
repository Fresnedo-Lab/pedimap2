# Pedimap 2 `.dat` Format — Parser Specification

> **Status:** authoritative. This document defines how a conforming Pedimap 2
> parser MUST interpret a `.dat` file. Where the wording says MUST / MUST NOT /
> MAY, it is normative.
>
> **Source attribution.** Format derived from Pedimap 1.x (Voorrips, Bink &
> van de Weg 2012) and its accompanying manual. This specification is original
> documentation written for Pedimap 2; it does not reproduce text from the
> original manual, which is copyrighted by Wageningen UR.

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
comment stripping) are ignored and MAY appear freely between sections.

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
| `NALLELES` | `0` | Number of founder alleles per locus for IBD data. `0` or absent ⇒ **no IBD data** in the file. |
| `PLOIDY` | `2` | Ploidy level of the population. |

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
identity-by-descent (IBD) probability data. If it is absent or `0`, the parser
MUST treat the file as having no IBD data even if stray IBD-looking lines were
present, and SHOULD warn on any orphaned IBD statement. If it is a positive
integer *N*, every IBD section provides exactly *N* probabilities per homologue
(§7).

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
columns).

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
`Elstar`, `elstar`, and `ELSTAR` are three different individuals. A parent name
that does not resolve to a defined individual (and is not an `UNKNOWN` symbol or
a uniparental keyword) is an error.

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

---

## 7. IBD sections

Present only when `NALLELES` is a positive integer *N* (§2.2). Each IBD section
is tied to one linkage group and one position via an `IBDPOSITIONS` /
`IBDPOSITION` statement, and provides IBD founder-allele probabilities for every
individual.

### 7.1 Layout per individual

For each individual the section gives, in order:

1. *N* probabilities for the **first homologue**, then
2. *N* probabilities for the **second homologue**,
3. and, for ploidy > 2, a further set of *N* per additional homologue
   (`PLOIDY` sets of *N* values in total).

Example (`NALLELES = 8`, `PLOIDY = 2`) — 8 maternal then 8 paternal values:

```
;               maternal IBD probabilities              paternal IBD probabilities
;allele number: 1   2   3   4   5   6   7   8           1   2   3   4   5   6   7   8
81015-045       0.22 0  0.78 0   0   0   0   0          0   0   0   0   0  1.0  0   0
```

### 7.2 Each homologue sums to 1; no missing data

Within each homologue, the *N* probabilities MUST sum to 1 (subject to a small
floating-point tolerance). Missing data is **not permitted** in an IBD section —
every probability MUST be present. The parser MUST error on a homologue whose
values do not sum to 1 or that has fewer/more than *N* values.

### 7.3 Completeness and order

- **Every individual in the pedigree** MUST appear in **every** IBD section. A
  missing individual is an error naming the individual and the section.
- Individuals MAY be listed in **any order** within a section; the parser keys
  rows by name (case-sensitive, §3.4), not by position.

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
- [ ] Topological sort: parents before children; stable sib order; cycle error naming all members.
- [ ] Marker color codes 0–9 distinct; > 9 gray.
- [ ] LG annotation delimiter accepts both `;` and `/`.
- [ ] IBD: homologues sum to 1, no missing data, every individual in every section, any order.
- [ ] All three valid subsets (§8.1–8.3) parse.
