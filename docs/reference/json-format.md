# Pedimap 2 JSON format

> **Status:** authoritative for format version 1. This document defines the
> file that **Save as JSON** writes and that Pedimap 2 opens (`/api/export/json`
> and `/api/load` in the backend). Where it says MUST, SHOULD or MAY, it is
> normative.

A Pedimap 2 JSON file holds a whole population with all of its data: the
pedigree, trait values, marker genotypes with their codes, IBD probabilities,
and what Pedimap read from the source file's header. Opening a saved file
gives the same data as the file it was saved from. View settings (style,
orientation, colors, bar width) are not part of it.

Save as JSON always writes the **whole population**, also while a
subpopulation is shown; a subpopulation is saved with Export subpopulation
(`.dat`), which marks IBD data that refers to founders outside the file
([`dat-format.md`](dat-format.md) §7.4).

---

## 1. Encoding and layout

- The file is UTF-8 JSON (RFC 8259), one object at the top level.
- Pedimap writes it without indentation; readers MUST accept any whitespace.
- Field order carries no meaning, except that Pedimap writes `format` and
  `format_version` first, so a reader can identify the file from its first
  bytes.

## 2. Format and version

| Field | Type | Value |
|---|---|---|
| `format` | string | `"pedimap2-json"` |
| `format_version` | integer | `1` for files described here |

**Writers** MUST write both fields. The version rises only when a reader of
the previous version would misread the file (a field changing its meaning or
its shape); new optional fields do not raise it.

**Readers:**

- A file without `format` is the JSON of Pedimap 2.4 and earlier: read it as
  version 1.
- A file whose `format` is another string is not a Pedimap 2 JSON file: refuse
  it. (Pedimap: "Not a Pedimap 2 JSON file (its format is '…').")
- A file whose `format_version` is higher than the reader's SHOULD be read as
  far as the reader understands it, ignoring unknown fields, with a warning
  that some data may not be shown. (Pedimap 2.5 reads version 1 and warns:
  "This file is in Pedimap 2 JSON format version 2, from a newer Pedimap 2;
  this version reads version 1, so some of its data may not be shown.")
- Readers MUST ignore fields they do not know.

## 3. Top-level fields

| Field | Type | Meaning |
|---|---|---|
| `population` | string | The population's name (the source file's `POPULATION`) |
| `ploidy` | integer | The population's ploidy |
| `individual_count` | integer | The number of individuals; informative only, readers MUST NOT rely on it |
| `individuals` | object | The individuals, by id (§4) |
| `traits` | array | The trait definitions, in column order (§5) |
| `markers` | array | The loci, in linkage-group and map order (§6) |
| `ibd` | object | The IBD probabilities (§7); `{}` without IBD data |
| `marker_codes` | object | The genotype codes (§8); `{}` without marker data |
| `dat_meta` | object | What Pedimap read from the source file's header and layout (§9) |

All fields but `format`, `format_version` and `individuals` are optional for
readers; Pedimap reads a missing one as empty (or `ploidy` as 2).

## 4. Individuals

`individuals` maps each individual's id to an object:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | The id; the same as the key |
| `name` | string | The name shown; for `.dat` sources, equal to the id |
| `female_parent` | string or `null` | The first parent: the parent of the `FEMALE`, `MOTHER` or `PARENT1` column of the source file. `null` if unknown |
| `male_parent` | string or `null` | The second parent (`MALE`, `FATHER` or `PARENT2`). `null` if unknown, and for single-parent descent other than selfing; a selfed individual (`"self"`) has its parent in both fields |
| `cross_type` | string | `"cross"`, `"self"`, `"dh"`, `"clone"` (vegetative propagation), `"mut"`, `"backcross"`, `"op"` (open pollinated) or `"unknown"` (founders) |
| `ploidy` | integer | The individual's ploidy |
| `generation` | integer | 0 for founders, otherwise one more than the higher of the parents'. Informative: Pedimap recomputes it from the parents before it uses or writes it |
| `traits` | object | Trait values by trait name: a number for a continuous trait, a string for a discrete one. A missing value is absent |
| `markers` | object | Observed alleles by locus name: an array of `ploidy` strings, in the order of the source file's parent columns |
| `notes` | string | Free text; empty if none |

The field names `female_parent` and `male_parent` do not assert sex: whether
the parents are female and male depends on the source file's caption,
recorded in `dat_meta.parent_columns` (§9).

## 5. Traits

| Field | Type | Meaning |
|---|---|---|
| `name` | string | The trait's name |
| `type` | string | `"continuous"` or `"qualitative"` (discrete) |
| `min`, `max` | number | The trait's range, for continuous traits |
| `categories` | array of strings | The values of a discrete trait |
| `color_low`, `color_high` | string | The trait's own colors (`#RRGGBB`) for the lowest and highest values |
| `value_colors` | object | Colors of discrete values, by value |

## 6. Markers

| Field | Type | Meaning |
|---|---|---|
| `name` | string | The locus name |
| `linkage_group` | string | Its linkage group |
| `position_cM` | number | Its map position |
| `allele_names` | array of strings | The allowed allele names (`ALLELENAMES`) |
| `founder_alleles` | array of strings | The allele of each founder allele (`FOUNDERALLELES`), in founder-allele order; empty without IBD data |

## 7. IBD probabilities

`ibd` maps a linkage group to an object that maps each IBD position (a
string, as written in the source file, for example `"0"` or `"40.000"`) to an
object that maps each individual's id to its rows:

```json
"ibd": { "A": { "0": { "81015-045": [[0.22, 0, 0.78, 0, 0, 0, 0, 0],
                                     [0, 0, 0, 0, 0, 1.0, 0, 0]] } } }
```

- Each individual has `ploidy` rows (homologues), in the order of the source
  file's parent columns; each row has `dat_meta.nalleles` probabilities, one
  per founder allele, numbered from 1 in `dat_meta.founder_order`.
- Probabilities are as read (FlexQTL rounds them, so a row may sum to slightly
  more or less than 1).

## 8. Genotype codes

`marker_codes` maps an individual's id to an object that maps each locus name
to an array of `ploidy` integers: the code after each allele in the source
file. JSON saved by Pedimap 2.2.2 and earlier has them as strings of digits;
readers SHOULD accept both.

## 9. Source metadata (`dat_meta`)

What Pedimap read from the source file that the fields above do not hold. A
reader that writes the file again MUST keep `dat_meta` as it is, including
keys it does not know. The keys Pedimap uses:

| Key | Meaning |
|---|---|
| `parent_columns` | The source caption's two parent columns, for example `["FEMALE", "MALE"]` or `["PARENT1", "PARENT2"]`. Without it, the parents are labeled "Parent 1" and "Parent 2" |
| `unknown`, `nullhomoz`, `confirmednull` | The source file's symbols for an unknown value, a homozygous null allele and a confirmed null allele |
| `nalleles` | The number of founder alleles per locus |
| `founder_order` | The founders whose alleles are founder alleles 1 and 2, 3 and 4, … |
| `ibd_positions` | The IBD positions of each linkage group, in order |
| `source_order` | The order of the individuals in the source file |
| `factor0` | Where the source file's `FACTOR0` column was, and its values |
| `locus_index` | The index written on each `LOCUS` line, where the source had one |
| `ibd_format` | How the source wrote its probabilities, so a `.dat` export can write them the same way |
| `parents_without_row`, `supplied_ibd_rows` | Parents that had no row of their own, and founders whose IBD rows Pedimap supplied ([`dat-format.md`](dat-format.md) §3.4, §7.6) |
| `ibd_founders` | Set for a subset whose IBD data refers to the source population's founders ([`dat-format.md`](dat-format.md) §7.4) |

## 10. Example

A complete file for a founder and its selfed offspring, without markers:

```json
{"format": "pedimap2-json", "format_version": 1,
 "population": "Selfing", "ploidy": 2, "individual_count": 2,
 "individuals": {
   "A": {"id": "A", "name": "A", "female_parent": null, "male_parent": null,
         "cross_type": "unknown", "ploidy": 2, "generation": 0,
         "traits": {"Height": 112}, "markers": {}, "notes": ""},
   "A-S1": {"id": "A-S1", "name": "A-S1", "female_parent": "A", "male_parent": "A",
            "cross_type": "self", "ploidy": 2, "generation": 1,
            "traits": {"Height": 105}, "markers": {}, "notes": ""}},
 "traits": [{"name": "Height", "type": "continuous", "min": 105, "max": 112,
             "categories": [], "color_low": "#3B82F6", "color_high": "#EF4444",
             "value_colors": {}}],
 "markers": [], "ibd": {}, "marker_codes": {},
 "dat_meta": {"parent_columns": ["FEMALE", "MALE"]}}
```
