"""
pmp_parser.py  –  Pedimap 2
============================
Parser for the legacy Pedimap 1.x ``.dat`` (data) and ``.pmp`` (parameter)
files. Produces a :class:`PedigreeEngine`.

The normative behavior is documented in ``docs/reference/dat-format.md``; the
bundled ``backend/tests/fixtures/Example.dat`` / ``Example.pmp`` are the
ground-truth conformance fixtures.

Public API (used by api.py):
    PmpParser.from_dat_text(dat_text)            -> ParseResult
    PmpParser.from_pmp_text(pmp_text, dat_text)  -> ParseResult
    DatExporter.to_dat_text(engine, ids=None)    -> str
The parsers return a ParseResult whose ``.engine`` is a populated
PedigreeEngine; the exporter writes an engine back as ``.dat`` text that
parses to an identical ``to_dict()``.
"""
from __future__ import annotations

import heapq
from collections import Counter
from difflib import SequenceMatcher
import math
import re
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional, Tuple

import networkx as nx

from pedigree_engine import (
    CrossType,
    Individual,  # noqa: F401  (kept for API parity / typing intent)
    MarkerMeta,
    PedigreeEngine,
    TraitMeta,
    TraitType,
)

# ── Constants ─────────────────────────────────────────────────────────────────

# A "number" per the spec: optional sign, integer or decimal real, single dot.
# Deliberately stricter than float() (rejects 1e5 / inf / nan) so trait-type
# inference matches the documented rule rather than float-parseability.
_NUMBER_RE = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)$")

# A genotype indicator code: any non-negative integer.
_CODE_RE = re.compile(r"^\d+$")

# The optional third field of a LOCUS line: the locus's index, "(9)".
_LOCUS_INDEX_RE = re.compile(r"^\((\d+)\)$")

# Uniparental (single-parent) procreation keywords, second-parent column.
_UNIPARENTAL = {
    "SELF": CrossType.SELF,
    "DH":   CrossType.DOUBLED_HAPLOID,
    "VP":   CrossType.CLONE,
    "MUT":  CrossType.MUTANT,
}

# Section keywords that begin a new block (case-insensitive).
_SECTION_KEYWORDS = {
    "PEDIGREE", "LINKAGEGROUP", "MAP", "LOCUS", "ALLELENAMES",
    "FOUNDERALLELES", "IBDPOSITIONS", "ALLELES", "IBDPOSITION",
}
_HEADER_KEYS = {"POPULATION", "UNKNOWN", "NULLHOMOZ", "CONFIRMEDNULL", "NALLELES", "PLOIDY"}

# The pedigree column FlexQTL and Binko write after the parents: each
# individual's place in the pedigree (0 founder, 1 with offspring, 2 without).
# It is metadata, not a trait (docs/reference/flexqtl-binko-pedimap, 4.1).
_FACTOR0 = "FACTOR0"

# Parent-column caption aliases -> which physical column is female / male.
# value is (female_first: bool)
_PARENT_ALIASES = {
    ("FEMALE", "MALE"):     True,
    ("MOTHER", "FATHER"):   True,
    ("MALE", "FEMALE"):     False,
    ("FATHER", "MOTHER"):   False,
    ("PARENT1", "PARENT2"): True,   # neutral: treat p1 as "female slot", no sex asserted
}

# The linkage group named in the comment of an IBDPOSITION line: "LG 1"
# (Binko, Example.dat) or "Linkage Group 1" (FlexQTL). Used only to cross-check
# the group the section gets from the order of the IBDPOSITIONS lines.
_LG_ANNOTATION_RE = re.compile(r"^(?:LG|Linkage\s+Group)\s+(\S+)", re.IGNORECASE)


# Pedimap 2 extension: a trait's type declared in a full-line comment,
#     ; PEDIMAP2 TRAITTYPE <trait name> discrete|continuous
# Written by DatExporter so a file (e.g. a subset) whose remaining values would
# be inferred differently still reads back with the original type. Being a
# comment, other readers such as Pedimap 1.x ignore it.
_TRAITTYPE_RE = re.compile(r"^\s*;\s*PEDIMAP2\s+TRAITTYPE\s+(.*)$", re.IGNORECASE)
_DECLARED_TYPE = {"discrete": "qualitative", "qualitative": "qualitative",
                  "continuous": "continuous"}
_WRITTEN_TYPE = {TraitType.QUALITATIVE: "discrete", TraitType.CONTINUOUS: "continuous"}

# Pedimap 2 extension: the founder alleles of the file's IBD data belong to the
# population it was exported from, not to the founders in the file,
#     ; PEDIMAP2 IBDFOUNDERS SOURCE
# Written by DatExporter on a subset export (dat-format.md §7.4). Such a file
# keeps its source's NALLELES, and its founder rows keep their source
# probabilities, so the founder-allele checks of §7.5 do not apply to it.
# Subsets exported by Pedimap 2.2.2 and earlier say "Subpopulation of:" in
# their head instead, and are recognized by that.
_IBDFOUNDERS_RE = re.compile(r"^\s*;\s*PEDIMAP2\s+IBDFOUNDERS\s+SOURCE\b", re.IGNORECASE)
_IBDFOUNDERS_LINE = "PEDIMAP2 IBDFOUNDERS SOURCE"
_OLD_SUBSET_HEAD = ("; Exported by Pedimap 2", "; Subpopulation of:")


def _declared_trait_types(lines: List[str]) -> Dict[str, str]:
    """{trait name: "qualitative"|"continuous"} from PEDIMAP2 TRAITTYPE comments."""
    declared: Dict[str, str] = {}
    for line in lines:
        m = _TRAITTYPE_RE.match(line)
        if not m:
            continue
        toks = _tokenize(m.group(1))
        if len(toks) >= 2 and toks[1].lower() in _DECLARED_TYPE:
            declared[toks[0]] = _DECLARED_TYPE[toks[1].lower()]
    return declared


def _declares_source_founders(lines: List[str]) -> bool:
    """True for a subset Pedimap 2 exported (see _IBDFOUNDERS_RE)."""
    if any(_IBDFOUNDERS_RE.match(line) for line in lines):
        return True
    head: List[str] = []
    for line in lines:                       # the comment lines before any data
        if line.strip() and not line.lstrip().startswith(";"):
            break
        head.append(line.strip())
    return (bool(head) and head[0] == _OLD_SUBSET_HEAD[0]
            and any(h.startswith(_OLD_SUBSET_HEAD[1]) for h in head))


class DatParseError(ValueError):
    """Raised for any malformed .dat input, with a human-readable message."""


class ParseResult:
    def __init__(self, engine: PedigreeEngine, warnings: Optional[List[str]] = None) -> None:
        self.engine = engine
        # Problems that did not stop the file from loading (e.g. IBD sums
        # outside their rounding tolerance, FACTOR0 against the pedigree).
        self.warnings: List[str] = list(warnings or [])


# ── Lexing helpers ────────────────────────────────────────────────────────────

def _split_lines(text: str) -> List[str]:
    """Lines ended by LF, CRLF or CR. (str.splitlines also splits on form
    feeds and other separators, which would shift the line numbers.)"""
    return re.split(r"\r\n|\r|\n", text)


def _strip_comment(line: str) -> str:
    """Drop everything from the first unquoted ';' to end of line."""
    out: List[str] = []
    in_q = False
    for ch in line:
        if ch == '"':
            in_q = not in_q
            out.append(ch)
        elif ch == ";" and not in_q:
            break
        else:
            out.append(ch)
    return "".join(out)


def _split_annotation(line: str) -> Tuple[str, Optional[str]]:
    """Split at the first unquoted ';' or '/' into (main, annotation).

    The linkage-group annotation on IBDPOSITION/ALLELES statements is delimited
    by ';' normally, but the original tool tolerated '/', and Example.dat relies
    on it ("IBDPOSITION 0 / LG C"). Accept both.
    """
    in_q = False
    for i, ch in enumerate(line):
        if ch == '"':
            in_q = not in_q
        elif ch in ";/" and not in_q:
            return line[:i], line[i + 1:].strip()
    return line, None


def _tokenize(line: str) -> List[str]:
    """Whitespace split, honoring double-quoted tokens (names with spaces)."""
    return [_unquote(t) for t in re.findall(r'"[^"]*"|\S+', line)]


def _unquote(t: str) -> str:
    if len(t) >= 2 and t[0] == '"' and t[-1] == '"':
        return t[1:-1]
    return t


def _is_number(s: str) -> bool:
    return bool(_NUMBER_RE.match(s))


def _lg_from_annotation(annot: Optional[str]) -> Optional[str]:
    """'LG A' -> 'A'; 'Linkage Group 1' -> '1'; anything else -> None."""
    if not annot:
        return None
    m = _LG_ANNOTATION_RE.match(annot.strip())
    return m.group(1) if m else None


def _decimals(token: str) -> int:
    """Number of digits after the decimal point of a number token."""
    return len(token) - token.index(".") - 1 if "." in token else 0


def _probability_token(v: float, fmt: Dict[str, Any]) -> str:
    """A probability written as a file wrote its probabilities (see
    _DatParser._ibd_format): its token for exact 0 and 1, else its decimals."""
    if v == 0.0 and fmt.get("zero") is not None:
        return fmt["zero"]
    if v == 1.0 and fmt.get("one") is not None:
        return fmt["one"]
    decimals = fmt.get("decimals")
    if decimals is not None:
        text = f"{v:.{decimals}f}"
        if float(text) == v:
            return text
    return _fmt_compact(v)


def _edit_distance(a: str, b: str, limit: int) -> int:
    """Levenshtein distance of a and b, or limit + 1 once it exceeds limit."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1,
                               previous[j - 1] + (ca != cb)))
        if min(current) > limit:
            return limit + 1
        previous = current
    return previous[-1]


def _closest_name(name: str, names: Iterable[str]) -> Optional[str]:
    """The name nearest to ``name`` ignoring case, if it is within a small edit
    distance: 1 for names up to 5 characters, 2 for longer ones.

    Among names equally near, the most similar one wins: F001 is one edit from
    F002 and from F0001, but F0001 keeps all four of its characters in order."""
    limit = 1 if len(name) <= 5 else 2
    key = name.lower()
    best, best_rank = None, (limit + 1, 0.0)
    for other in names:
        d = _edit_distance(key, other.lower(), limit)
        if d > limit:
            continue
        rank = (d, -SequenceMatcher(None, key, other.lower()).ratio())
        if rank < best_rank:
            best, best_rank = other, rank
    return best


def _few(names: List[str], limit: int = 5) -> str:
    """'A, B, C' or 'A, B, C, D, E and 3 more'."""
    shown = ", ".join(names[:limit])
    return shown if len(names) <= limit else f"{shown} and {len(names) - limit} more"


# ── DAT parser ────────────────────────────────────────────────────────────────

class _DatParser:
    def __init__(self, text: str) -> None:
        self.lines = _split_lines(text)
        self.n = len(self.lines)
        self.i = 0
        self.declared_types = _declared_trait_types(self.lines)
        self.source_founders = _declares_source_founders(self.lines)
        self.warnings: List[str] = []

        # settings
        self.population: Optional[str] = None
        self.ploidy = 2
        self.nalleles: Optional[int] = None           # None: no NALLELES line
        self.nalleles_line = 0
        self.unknown = ["-"]
        self.nullhomoz = "$"
        self.declared_nullhomoz: Optional[str] = None  # as the NULLHOMOZ line says
        self.confirmednull: Optional[str] = None
        self._pedigree_started = False

        # pedigree
        self.female_first = True
        self.female_idx = 0
        self.male_idx = 1
        self.parent_labels: List[str] = ["FEMALE", "MALE"]   # caption cols 2-3 as read
        self.ncols = 0                                # fields per pedigree row
        self.factor0_idx: Optional[int] = None        # FACTOR0's index in a row
        self.trait_cols: List[Tuple[str, int]] = []   # (name, col index after NAME)
        self.records: List[dict] = []                 # ordered raw individuals
        self.ids: List[str] = []
        self.id_set: set = set()
        self.parent_names: set = set()                # every name in a parent column
        self.parents_without_row: List[str] = []

        # markers
        self.current_lg: Optional[str] = None
        self.current_locus: Optional[str] = None
        self.markers: Dict[str, dict] = {}            # name -> {lg,pos,allele_names,founder_alleles}
        self.marker_order: List[str] = []
        self.locus_index: Dict[str, int] = {}
        self.loci_seen: set = set()
        self.ibd_lines: List[Tuple[int, str, List[str]]] = []   # (line, group, positions)
        self.alleles_sections: set = set()
        self.observed: Dict[str, Dict[str, List[str]]] = {}
        self.codes: Dict[str, Dict[str, List[int]]] = {}       # parallel indicator codes

        # IBD sections in file order, and the decimals of their probabilities
        self.sections: List[dict] = []
        self.prob_decimals = 0
        self.assigned: List[Tuple[str, dict]] = []    # (linkage group, section)

    # -- line helpers --
    def _clean(self, raw: str) -> str:
        return _strip_comment(raw).strip()

    def _first_key(self, cleaned: str) -> Optional[str]:
        if not cleaned:
            return None
        return _tokenize(cleaned)[0].upper()

    def _setting_key(self, cleaned: str) -> Optional[str]:
        """The settings keyword of a 'KEY = value' (or 'KEY value') line."""
        if "=" in cleaned:
            key = cleaned.split("=", 1)[0].strip().upper()
            if key in _HEADER_KEYS:
                return key
        key = self._first_key(cleaned)
        return key if key in _HEADER_KEYS else None

    def _is_block_boundary(self, cleaned: str) -> bool:
        key = self._first_key(cleaned)
        return key in _SECTION_KEYWORDS or (
            not self._pedigree_started and self._setting_key(cleaned) is not None
        )

    def _error(self, message: str, line: Optional[int] = None) -> DatParseError:
        """An error at ``line`` (1-based; default: the line being read)."""
        return DatParseError(f"Line {line or self.i + 1}: {message}")

    # -- main --
    def parse(self) -> PedigreeEngine:
        while self.i < self.n:
            raw = self.lines[self.i]
            cleaned = self._clean(raw)
            if not cleaned:
                self.i += 1
                continue
            key = self._first_key(cleaned)
            setting = None if self._pedigree_started else self._setting_key(cleaned)

            if setting:
                self._parse_setting(setting, cleaned)
                self.i += 1
                continue
            if key == "PEDIGREE":
                self.i += 1
                self._parse_pedigree()
                continue
            if key == "LINKAGEGROUP":
                toks = _tokenize(cleaned)
                self.current_lg = toks[1] if len(toks) > 1 else ""
                self.current_locus = None
                self.i += 1
                continue
            if key == "MAP":
                self.i += 1
                self._parse_map()
                continue
            if key == "LOCUS":
                self._begin_locus(_tokenize(cleaned))
                self.i += 1
                continue
            if key == "ALLELENAMES":
                self._set_locus_field("allele_names", _tokenize(cleaned)[1:])
                self.i += 1
                continue
            if key == "FOUNDERALLELES":
                self._founder_alleles(_tokenize(cleaned)[1:])
                self.i += 1
                continue
            if key == "IBDPOSITIONS":
                self._ibd_positions(_tokenize(cleaned)[1:])
                self.i += 1
                continue
            if key == "ALLELES":
                toks = _tokenize(cleaned)
                if len(toks) < 2:
                    raise self._error("ALLELES needs a locus name.")
                marker = toks[1]
                if marker in self.alleles_sections:
                    raise self._error(f"a second ALLELES section for the locus {marker!r}.")
                self.alleles_sections.add(marker)
                self.i += 1
                self._parse_observed(marker)
                continue
            if key == "IBDPOSITION":
                self._parse_ibd_block(raw)
                continue

            # Unknown line outside any known section: skip defensively.
            self.i += 1

        return self._build_engine()

    # -- settings --
    def _parse_setting(self, key: str, cleaned: str) -> None:
        if "=" in cleaned and cleaned.split("=", 1)[0].strip().upper() == key:
            rest = cleaned.split("=", 1)[1].strip()
        else:
            rest = cleaned.split(None, 1)[1].strip() if len(cleaned.split(None, 1)) > 1 else ""
        vals = rest.split()
        if key == "POPULATION":
            self.population = rest or None
        elif key == "UNKNOWN":
            self.unknown = vals or ["-"]
        elif key == "NULLHOMOZ":
            self.nullhomoz = vals[0] if vals else "$"
            self.declared_nullhomoz = vals[0] if vals else None
        elif key == "CONFIRMEDNULL":
            self.confirmednull = vals[0] if vals else None
        elif key in ("NALLELES", "PLOIDY"):
            if len(vals) != 1 or not vals[0].isdigit():
                raise self._error(f"{key} must be a whole number (got {rest!r}).")
            value = int(vals[0])
            if key == "NALLELES":
                self.nalleles, self.nalleles_line = value, self.i + 1
            elif value < 1:
                raise self._error("PLOIDY must be at least 1.")
            else:
                self.ploidy = value

    # -- pedigree --
    def _parse_pedigree(self) -> None:
        self._pedigree_started = True
        # caption = next non-blank cleaned line
        caption = None
        while self.i < self.n:
            cleaned = self._clean(self.lines[self.i])
            if cleaned:
                caption = cleaned
                self.i += 1
                break
            self.i += 1
        if caption is None:
            raise DatParseError("PEDIGREE section has no caption line.")

        cols = _tokenize(caption)
        if not cols or cols[0].upper() != "NAME":
            raise self._error(f"Pedigree caption must start with NAME (got: {caption!r}).", self.i)
        if len(cols) < 3:
            raise self._error("Pedigree caption needs NAME + two parent columns.", self.i)

        pa, pb = cols[1].upper(), cols[2].upper()
        if (pa, pb) not in _PARENT_ALIASES:
            raise self._error(
                f"Unrecognized parent columns {cols[1]!r}/{cols[2]!r}. Expected one of "
                "FEMALE/MALE, MOTHER/FATHER, PARENT1/PARENT2 (either order).", self.i
            )
        self.female_first = _PARENT_ALIASES[(pa, pb)]
        self.parent_labels = [cols[1], cols[2]]
        # physical column indices (0-based, within the whole row incl. NAME at 0)
        self.female_idx = 1 if self.female_first else 2
        self.male_idx = 2 if self.female_first else 1
        self.ncols = len(cols)
        factor0 = [3 + k for k, name in enumerate(cols[3:]) if name.upper() == _FACTOR0]
        self.factor0_idx = factor0[0] if factor0 else None
        self.trait_cols = [(name, 3 + k) for k, name in enumerate(cols[3:])
                           if 3 + k != self.factor0_idx]

        # data rows
        while self.i < self.n:
            cleaned = self._clean(self.lines[self.i])
            if not cleaned:
                self.i += 1
                continue
            if self._is_block_boundary(cleaned):
                break
            self._parse_pedigree_row(_tokenize(cleaned))
            self.i += 1

    def _parse_pedigree_row(self, toks: List[str]) -> None:
        if len(toks) != self.ncols:
            raise self._error(
                f"the pedigree row of {toks[0]!r} has {len(toks)} fields, but the caption "
                f"has {self.ncols}."
            )
        ind_id = toks[0]
        if ind_id in self.id_set:
            raise self._error(f"Duplicate individual name: {ind_id!r}")
        if ind_id in self.unknown:
            raise self._error(f"an individual is named {ind_id!r}, an UNKNOWN symbol.")
        f_tok = toks[self.female_idx]
        m_tok = toks[self.male_idx]
        raw_traits: Dict[str, str] = {}
        for name, idx in self.trait_cols:
            val = toks[idx]
            if val not in self.unknown:
                raw_traits[name] = val
        factor0 = None
        if self.factor0_idx is not None and toks[self.factor0_idx] not in self.unknown:
            factor0 = toks[self.factor0_idx]
        for tok in (f_tok, m_tok):
            kind, value = self._classify_token(tok)
            if kind == "name":
                self.parent_names.add(value)
        self.records.append({
            "id": ind_id, "f_tok": f_tok, "m_tok": m_tok, "raw_traits": raw_traits,
            "factor0": factor0, "line": self.i + 1,
        })
        self.ids.append(ind_id)
        self.id_set.add(ind_id)

    def _known_individual(self, name: str) -> bool:
        """In the pedigree table, or named as a parent (a parent without a row)."""
        return name in self.id_set or name in self.parent_names

    # -- markers --
    def _parse_map(self) -> None:
        while self.i < self.n:
            cleaned = self._clean(self.lines[self.i])
            if not cleaned:
                self.i += 1
                continue
            if self._is_block_boundary(cleaned):
                break
            toks = _tokenize(cleaned)
            if len(toks) != 2 or not _is_number(toks[1]):
                raise self._error(f"a MAP row is a locus name and a position (got {cleaned!r}).")
            marker = toks[0]
            if marker in self.markers:
                raise self._error(f"the locus {marker!r} is in the map twice.")
            self.markers[marker] = {
                "lg": self.current_lg or "", "pos": float(toks[1]),
                "allele_names": [], "founder_alleles": [],
            }
            self.marker_order.append(marker)
            self.i += 1

    def _begin_locus(self, toks: List[str]) -> None:
        if len(toks) not in (2, 3):
            raise self._error("LOCUS takes a locus name and, optionally, its index in parentheses.")
        name = toks[1]
        group = self.current_lg or ""
        if name not in self.markers or self.markers[name]["lg"] != group:
            raise self._error(f"the locus {name!r} is not in the MAP of linkage group {group!r}.")
        if name in self.loci_seen:
            raise self._error(f"a second LOCUS block for {name!r}.")
        if len(toks) == 3:
            m = _LOCUS_INDEX_RE.match(toks[2])
            if not m:
                raise self._error(f"unexpected {toks[2]!r} after the locus name (an index is "
                                  "written in parentheses, e.g. (9)).")
            self.locus_index[name] = int(m.group(1))
        self.loci_seen.add(name)
        self.current_locus = name

    def _set_locus_field(self, field: str, values: List[str]) -> None:
        if self.current_locus is None:
            raise self._error(f"{field} statement outside of a LOCUS.")
        self.markers[self.current_locus][field] = values

    def _founder_alleles(self, values: List[str]) -> None:
        if not self.nalleles:
            raise self._error("FOUNDERALLELES in a file without NALLELES.")
        if len(values) != self.nalleles:
            raise self._error(f"FOUNDERALLELES lists {len(values)} alleles; NALLELES is "
                              f"{self.nalleles}.")
        self._set_locus_field("founder_alleles", values)

    def _ibd_positions(self, values: List[str]) -> None:
        if self.current_lg is None:
            raise self._error("IBDPOSITIONS outside a LINKAGEGROUP.")
        if any(group == self.current_lg for _, group, _ in self.ibd_lines):
            raise self._error(f"a second IBDPOSITIONS line in linkage group {self.current_lg!r}.")
        bad = [v for v in values if not _is_number(v)]
        if bad:
            raise self._error(f"the IBD position {bad[0]!r} is not a number.")
        self.ibd_lines.append((self.i + 1, self.current_lg, values))

    def _parse_observed(self, marker: str) -> None:
        names = self.markers.get(marker, {}).get("allele_names")
        allowed = None
        if names:
            # The file's own symbols: its UNKNOWN strings (default "-") and the
            # NULLHOMOZ and CONFIRMEDNULL symbols its lines declare.
            symbols = {self.declared_nullhomoz, self.confirmednull} - {None}
            allowed = set(names) | set(self.unknown) | symbols
        width = 1 + 2 * self.ploidy
        while self.i < self.n:
            cleaned = self._clean(self.lines[self.i])
            if not cleaned:
                self.i += 1
                continue
            if self._is_block_boundary(cleaned):
                break
            toks = _tokenize(cleaned)
            ind = toks[0]
            if len(toks) != width:
                raise self._error(
                    f"an ALLELES row is a name and {self.ploidy} (allele, code) pairs: "
                    f"{width} fields, not {len(toks)}."
                )
            if not self._known_individual(ind):
                raise self._error(f"ALLELES row of {ind!r}, which is not in the pedigree.")
            if marker in self.observed.get(ind, {}):
                raise self._error(f"a second row for {ind!r} in the ALLELES section of {marker!r}.")
            alleles, codes = toks[1::2], toks[2::2]
            for code in codes:
                if not _CODE_RE.match(code):
                    raise self._error(f"the indicator code {code!r} is not a whole number "
                                      "(0 or more).")
            if allowed is not None:
                for allele in alleles:
                    if allele not in allowed:
                        raise self._error(
                            f"the allele {allele!r} of {ind!r} is not on the ALLELENAMES line "
                            f"of {marker!r}, nor a symbol of the file's UNKNOWN, NULLHOMOZ or "
                            "CONFIRMEDNULL line."
                        )
            self.observed.setdefault(ind, {})[marker] = alleles
            self.codes.setdefault(ind, {})[marker] = [int(c) for c in codes]
            self.i += 1

    # -- ibd --
    def _parse_ibd_block(self, raw: str) -> None:
        line = self.i + 1
        main, annot = _split_annotation(raw)
        mtoks = _tokenize(self._clean(main))  # main has no ';'; safe to clean
        if not self.nalleles:
            raise self._error(
                "IBDPOSITION in a file without NALLELES; cannot size the founder-allele "
                "probability vectors."
            )
        if self.ploidy != 2:
            raise self._error(f"IBD data for ploidy {self.ploidy} is not supported yet.")
        if len(mtoks) != 2 or not _is_number(mtoks[1]):
            raise self._error("IBDPOSITION takes one position.")
        self.i += 1

        expected = self.ploidy * self.nalleles
        rows: Dict[str, dict] = {}
        while self.i < self.n:
            cleaned = self._clean(self.lines[self.i])
            if not cleaned:
                self.i += 1
                continue
            if self._is_block_boundary(cleaned):
                break
            toks = _tokenize(cleaned)
            ind, vals = toks[0], toks[1:]
            if not self._known_individual(ind):
                raise self._error(f"IBD row of {ind!r}, which is not in the pedigree.")
            if len(vals) != expected:
                raise self._error(
                    f"the IBD row of {ind!r} has {len(vals)} values, expected {expected} "
                    f"(= ploidy {self.ploidy} x NALLELES {self.nalleles})."
                )
            bad = [v for v in vals if not _is_number(v)]
            if bad:
                raise self._error(f"the IBD row of {ind!r} has {bad[0]!r}, which is not a number.")
            nums = [float(v) for v in vals]
            if any(v < 0 or v > 1 for v in nums):
                raise self._error(f"the IBD row of {ind!r} has a probability outside 0 to 1.")
            if ind in rows:
                raise self._error(f"a second row for {ind!r} in this IBDPOSITION section.")
            for v in vals:
                self.prob_decimals = max(self.prob_decimals, _decimals(v))
            n = self.nalleles
            rows[ind] = {
                "line": self.i + 1,
                "tokens": vals,
                "homologues": [nums[h * n:(h + 1) * n] for h in range(self.ploidy)],
                # values not written as a bare "0" (the m of the sum tolerance)
                "m": [sum(v != "0" for v in vals[h * n:(h + 1) * n]) for h in range(self.ploidy)],
            }
            self.i += 1
        self.sections.append({"line": line, "pos": mtoks[1],
                              "annot_lg": _lg_from_annotation(annot), "rows": rows})

    # -- assembly --
    def _classify_token(self, tok: str) -> Tuple[str, Optional[str]]:
        if tok in self.unknown:
            return ("unknown", None)
        if tok.startswith("*") and tok[1:].upper() in _UNIPARENTAL:
            return ("keyword", tok[1:].upper())
        return ("name", tok)

    def _resolve_parents(self, f_tok: str, m_tok: str):
        ftype, fval = self._classify_token(f_tok)
        mtype, mval = self._classify_token(m_tok)

        if ftype == "keyword" or mtype == "keyword":
            kw = fval if ftype == "keyword" else mval
            parent_name = fval if ftype == "name" else (mval if mtype == "name" else None)
            ct = _UNIPARENTAL[kw]
            if ct == CrossType.SELF:
                return parent_name, parent_name, CrossType.SELF
            return parent_name, None, ct

        f = fval if ftype == "name" else None
        m = mval if mtype == "name" else None
        if f and m:
            return (f, m, CrossType.SELF) if f == m else (f, m, CrossType.CROSS)
        if not f and not m:
            return None, None, CrossType.UNKNOWN
        return f, m, CrossType.CROSS

    def _add_parents_without_row(self) -> None:
        """A parent named without a row of its own (Binko's files before its
        commit 955aefa) becomes a founder without data, placed just before the
        first row that names it — its place among the founders (spec 3.2, 5.2)."""
        records: List[dict] = []
        added: set = set()
        for rec in self.records:
            for tok in (rec["f_tok"], rec["m_tok"]):
                kind, name = self._classify_token(tok)
                if kind == "name" and name not in self.id_set and name not in added:
                    added.add(name)
                    self.parents_without_row.append(name)
                    records.append({"id": name, "f_tok": self.unknown[0],
                                    "m_tok": self.unknown[0], "raw_traits": {},
                                    "factor0": None, "line": rec["line"], "no_row": True})
            records.append(rec)
        if not added:
            return
        named = []
        for name in self.parents_without_row[:5]:
            near = _closest_name(name, self.ids)
            named.append(f"{name!r}" + (f" (closest existing individual: {near!r})"
                                        if near else ""))
        more = len(added) - len(named)
        self.warnings.append(
            f"{len(added)} parent(s) have no row of their own: {', '.join(named)}"
            + (f" and {more} more" if more else "") +
            ". Each was added as a founder without data; a name may be a misspelling "
            "of an individual of the pedigree."
        )
        self.records = records
        self.ids = [r["id"] for r in records]
        self.id_set = set(self.ids)

    def _check_factor0(self, individuals: Dict[str, dict]) -> None:
        """FACTOR0 is 0 for a founder, 1 for an individual with known parents and
        offspring, 2 for one without offspring. Warn where the file disagrees."""
        parents = {p for d in individuals.values()
                   for p in (d["female_parent"], d["male_parent"]) if p}
        wrong = []
        for rec in self.records:
            if rec.get("no_row"):
                continue
            d = individuals[rec["id"]]
            founder = d["female_parent"] is None and d["male_parent"] is None
            expected = 0 if founder else (1 if rec["id"] in parents else 2)
            tok = rec["factor0"]
            if tok is None or not tok.isdigit() or int(tok) != expected:
                wrong.append((rec, expected))
        if wrong:
            rec, expected = wrong[0]
            self.warnings.append(
                f"FACTOR0 does not match the pedigree for {len(wrong)} individual(s); the "
                f"first is {rec['id']!r} on line {rec['line']}: {rec['factor0'] or '-'}, "
                f"expected {expected} (0 founder, 1 with offspring, 2 without). FACTOR0 is "
                "kept as read; it is not used for coloring."
            )

    def _assign_ibd_sections(self) -> List[Tuple[str, dict]]:
        """[(linkage group, section)]: the k-th IBDPOSITION section belongs to the
        k-th position of the IBDPOSITIONS lines (spec 5.5)."""
        listed = [(line, group, pos) for line, group, positions in self.ibd_lines
                  for pos in positions]
        assigned: List[Tuple[str, dict]] = []
        keys: Dict[str, set] = {}
        misnamed: List[Tuple[dict, str]] = []
        for k, sec in enumerate(self.sections):
            if k >= len(listed):
                raise self._error(
                    f"IBDPOSITION section {k + 1}, but the IBDPOSITIONS lines list only "
                    f"{len(listed)} position(s).", sec["line"]
                )
            _, group, pos = listed[k]
            if abs(float(sec["pos"]) - float(pos)) > 1e-6:
                raise self._error(
                    f"IBDPOSITION {sec['pos']} is section {k + 1}, but position {k + 1} of the "
                    f"IBDPOSITIONS lines is {pos} (linkage group {group!r}).", sec["line"]
                )
            if sec["annot_lg"] is not None and sec["annot_lg"] != group:
                misnamed.append((sec, group))
            if sec["pos"] in keys.setdefault(group, set()):
                raise self._error(f"position {sec['pos']} of linkage group {group!r} is "
                                  "given twice.", sec["line"])
            keys[group].add(sec["pos"])
            assigned.append((group, sec))
        if len(listed) > len(self.sections):
            line, group, pos = listed[len(self.sections)]
            raise self._error(
                f"the IBDPOSITIONS lines list {len(listed)} position(s), but "
                f"{len(self.sections)} IBDPOSITION section(s) follow; none for {pos} of "
                f"linkage group {group!r}.", line
            )
        if misnamed:
            sec, group = misnamed[0]
            self.warnings.append(
                f"{len(misnamed)} IBDPOSITION section(s) have a comment naming another linkage "
                f"group than their place gives; the first is on line {sec['line']}: the comment "
                f"says {sec['annot_lg']!r}, the order of the IBDPOSITIONS lines gives "
                f"{group!r}. The order decides; the comment is ignored."
            )
        return assigned

    def _own_founder_alleles(self, homologues: List[List[float]]) -> Optional[int]:
        """k if the row is a founder's own: homologue h has probability 1 on
        founder allele k*ploidy + h and 0 elsewhere; otherwise None."""
        pair = None
        for h, vec in enumerate(homologues):
            ones = [j for j, v in enumerate(vec) if v == 1.0]
            if len(ones) != 1 or any(v != 0.0 for j, v in enumerate(vec) if j != ones[0]):
                return None
            k, rest = divmod(ones[0], self.ploidy)
            if rest != h or (pair is not None and k != pair):
                return None
            pair = k
        return pair

    def _founder_order(self, founders: List[str], assigned) -> List[str]:
        """The founder behind each set of founder alleles: from each founder's
        own IBD row, then the founders without a row in table order."""
        pair: Dict[str, int] = {}
        owner: Dict[int, str] = {}
        p = self.ploidy
        for group, sec in assigned:
            for f in founders:
                row = sec["rows"].get(f)
                if row is None:
                    continue
                k = self._own_founder_alleles(row["homologues"])
                if k is None:
                    raise self._error(
                        f"{f!r} is a founder, but its IBD row is not 1 on {p} founder alleles of "
                        f"its own (allele {p}f-{p - 1} in the first part ... allele {p}f in the "
                        "last) and 0 elsewhere.", row["line"]
                    )
                alleles = " and ".join(str(k * p + h + 1) for h in range(p))
                if f in pair and pair[f] != k:
                    before = " and ".join(str(pair[f] * p + h + 1) for h in range(p))
                    raise self._error(f"the founder {f!r} has founder alleles {alleles} here, "
                                      f"but {before} in an earlier section.", row["line"])
                if owner.get(k, f) != f:
                    raise self._error(f"the founder {f!r} has founder alleles {alleles}, which "
                                      f"belong to the founder {owner[k]!r}.", row["line"])
                pair[f], owner[k] = k, f
        free = [k for k in range(len(founders)) if k not in owner]
        for f in founders:
            if f not in pair:
                pair[f] = free.pop(0)
        order = [""] * len(founders)
        for f, k in pair.items():
            order[k] = f
        return order

    def _build_ibd(self, founders: List[str]) -> Tuple[dict, Optional[List[str]], dict]:
        """(ibd, founder order, supplied rows) from the IBDPOSITION sections."""
        if not self.nalleles:
            return {}, None, {}
        p = self.ploidy
        if not self.source_founders and self.nalleles != p * len(founders):
            without = (f", {len(self.parents_without_row)} of them parents without a row"
                       if self.parents_without_row else "")
            raise self._error(
                f"NALLELES is {self.nalleles}, but the pedigree has {len(founders)} founder(s)"
                f"{without}: {p} founder alleles each make {p * len(founders)}.",
                self.nalleles_line
            )
        assigned = self._assign_ibd_sections()
        self.assigned = assigned
        founder_set = set(founders)
        for group, sec in assigned:
            missing = [i for i in self.ids if i not in sec["rows"]]
            unsupplied = missing if self.source_founders else [i for i in missing
                                                               if i not in founder_set]
            if unsupplied:
                why = ("this file's founder alleles belong to the population it was exported "
                       "from, so every individual needs a row" if self.source_founders else
                       "only a founder's probabilities can be supplied")
                raise self._error(
                    f"the IBDPOSITION section of {sec['pos']} (linkage group {group!r}) has no "
                    f"row for {_few(unsupplied)}; {why}.", sec["line"]
                )

        order = None if self.source_founders else self._founder_order(founders, assigned)
        self._check_sums(assigned)

        ibd: Dict[str, Dict[str, Dict[str, List[List[float]]]]] = {}
        supplied: Dict[str, Dict[str, List[str]]] = {}
        for group, sec in assigned:
            block = {name: row["homologues"] for name, row in sec["rows"].items()}
            if order is not None:
                for k, f in enumerate(order):
                    if f not in block:      # a founder without a row: 1 on its own alleles
                        block[f] = [[1.0 if j == k * p + h else 0.0
                                     for j in range(self.nalleles)] for h in range(p)]
                        supplied.setdefault(group, {}).setdefault(sec["pos"], []).append(f)
            ibd.setdefault(group, {})[sec["pos"]] = block
        return ibd, order, supplied

    def _ibd_format(self) -> dict:
        """How the probabilities were written, so that an export writes them the
        same way: their decimals, the usual token of an exact 0 and of an exact
        1 ("0", "1.0", "0.0000", ...), and every token that differs from what
        those give (such as a rounded "0.00" among exact "0")."""
        counts: Dict[float, Counter] = {0.0: Counter(), 1.0: Counter()}
        for _, sec in self.assigned:
            for row in sec["rows"].values():
                for tok in row["tokens"]:
                    v = float(tok)
                    if v in counts:
                        counts[v][tok] += 1
        fmt: Dict[str, Any] = {
            "decimals": self.prob_decimals,
            "zero": counts[0.0].most_common(1)[0][0] if counts[0.0] else None,
            "one": counts[1.0].most_common(1)[0][0] if counts[1.0] else None,
        }
        tokens: Dict[str, Dict[str, Dict[str, Dict[str, str]]]] = {}
        for group, sec in self.assigned:
            for name, row in sec["rows"].items():
                odd = {str(j): tok for j, tok in enumerate(row["tokens"])
                       if tok != _probability_token(float(tok), fmt)}
                if odd:
                    tokens.setdefault(group, {}).setdefault(sec["pos"], {})[name] = odd
        if tokens:
            fmt["tokens"] = tokens
        return fmt

    def _check_sums(self, assigned) -> None:
        """Each homologue sums to 1 within the rounding of its values (spec 5.6):
        |sum - 1| <= m x 0.5 x 10^-d + 1e-9. Warn; the values are kept as read."""
        unit = 0.5 * 10.0 ** -self.prob_decimals
        off = []
        for group, sec in assigned:
            for name, row in sec["rows"].items():
                for h, vec in enumerate(row["homologues"]):
                    total = math.fsum(vec)
                    tolerance = row["m"][h] * unit + 1e-9
                    if abs(total - 1.0) > tolerance:
                        off.append((row["line"], name, group, sec["pos"], h + 1, total, tolerance))
        if off:
            line, name, group, pos, h, total, tolerance = off[0]
            self.warnings.append(
                f"{len(off)} IBD homologue(s) do not sum to 1 within the rounding of their "
                f"values; the first is {name!r} on line {line} (position {pos} of linkage "
                f"group {group!r}, homologue {h}): {total:.4f}, allowed 1 ± {tolerance:.4f}. "
                "The probabilities are kept as read."
            )

    def _infer_traits(self) -> Dict[str, dict]:
        """Return {trait_name: TraitMeta-dict}.

        A PEDIMAP2 TRAITTYPE declaration wins; otherwise (or if a declared
        "continuous" trait has a non-numeric value) the documented inference
        rule applies.
        """
        meta: Dict[str, dict] = {}
        for name, _idx in self.trait_cols:
            declared = self.declared_types.get(name)
            vals = [r["raw_traits"][name] for r in self.records if name in r["raw_traits"]]
            if not vals:
                meta[name] = ({"name": name, "type": "continuous"} if declared == "continuous"
                              else {"name": name, "type": "qualitative", "categories": []})
                continue
            all_single = all(len(v) == 1 for v in vals)
            any_non_number = any(not _is_number(v) for v in vals)
            if declared == "continuous" and any_non_number:
                declared = None                    # cannot be honored: infer instead
            discrete = (declared == "qualitative") if declared else (all_single or any_non_number)
            if discrete:
                cats: List[str] = []
                for v in vals:
                    if v not in cats:
                        cats.append(v)
                meta[name] = {"name": name, "type": "qualitative", "categories": cats}
            else:
                nums = [float(v) for v in vals]
                meta[name] = {
                    "name": name, "type": "continuous",
                    "min": min(nums), "max": max(nums),
                }
        return meta

    def _stable_topo_order(self, individuals: Dict[str, dict]) -> List[str]:
        """Kahn's algorithm, breaking ties by original file-appearance index.

        Guarantees parents precede children while preserving the file order of
        otherwise-unconstrained individuals (e.g. full sibs).
        """
        index = {iid: k for k, iid in enumerate(self.ids)}
        edges = set()
        for iid, idata in individuals.items():
            for pcol in ("female_parent", "male_parent"):
                p = idata[pcol]
                if p is not None and p in individuals and p != iid:
                    edges.add((p, iid))
        indeg = {iid: 0 for iid in individuals}
        children: Dict[str, List[str]] = {iid: [] for iid in individuals}
        for p, c in edges:
            children[p].append(c)
            indeg[c] += 1
        avail = [(index[iid], iid) for iid in individuals if indeg[iid] == 0]
        heapq.heapify(avail)
        order: List[str] = []
        while avail:
            _, iid = heapq.heappop(avail)
            order.append(iid)
            for c in children[iid]:
                indeg[c] -= 1
                if indeg[c] == 0:
                    heapq.heappush(avail, (index[c], c))
        if len(order) != len(individuals):
            # Unreachable: cycles are caught before this is called.
            return list(individuals.keys())
        return order

    def _build_engine(self) -> PedigreeEngine:
        if not self.records:
            raise DatParseError("No PEDIGREE individuals found.")

        self._add_parents_without_row()
        trait_meta = self._infer_traits()

        individuals: Dict[str, dict] = {}
        for rec in self.records:
            f, m, ct = self._resolve_parents(rec["f_tok"], rec["m_tok"])
            traits: Dict[str, Any] = {}
            for tname, raw in rec["raw_traits"].items():
                if trait_meta[tname]["type"] == "continuous":
                    traits[tname] = float(raw)
                else:
                    traits[tname] = raw
            individuals[rec["id"]] = {
                "name": rec["id"],
                "female_parent": f,
                "male_parent": m,
                "cross_type": ct.value,
                "ploidy": self.ploidy,
                "generation": 0,
                "traits": traits,
                "markers": self.observed.get(rec["id"], {}),
                "notes": "",
            }

        # Cycle detection with a clear, member-naming error.
        g = nx.DiGraph()
        g.add_nodes_from(individuals.keys())
        for iid, idata in individuals.items():
            for pcol in ("female_parent", "male_parent"):
                p = idata[pcol]
                if p is not None and p in individuals and p != iid:
                    g.add_edge(p, iid)
        if not nx.is_directed_acyclic_graph(g):
            cycle = nx.find_cycle(g)
            members = " -> ".join([u for u, _v in cycle] + [cycle[0][0]])
            raise DatParseError(
                f"Circular pedigree — the following individuals form an ancestry "
                f"cycle: {members}."
            )

        if self.factor0_idx is not None:
            self._check_factor0(individuals)

        # Founders in table order (parents without a row in their place), the
        # order of the founder alleles when the IBD rows do not say otherwise.
        founders = [iid for iid in self.ids
                    if individuals[iid]["female_parent"] is None
                    and individuals[iid]["male_parent"] is None]
        ibd, founder_order, supplied = self._build_ibd(founders)

        # Stable topological order: every individual follows its parents, with
        # ties broken by original file appearance so full-sib order is preserved
        # (dat-format spec §5). The file may list a child before its parents.
        order = self._stable_topo_order(individuals)
        individuals = {iid: individuals[iid] for iid in order}

        dat_meta: Dict[str, Any] = {
            "unknown":        list(self.unknown),
            "nullhomoz":      self.nullhomoz,
            "nalleles":       self.nalleles,
            "parent_columns": list(self.parent_labels),
            "source_order":   list(self.ids),
            "ibd_positions":  {group: list(p) for _, group, p in self.ibd_lines},
        }
        # Only what a file has, so that other files' metadata stays as it was.
        if self.confirmednull is not None:
            dat_meta["confirmednull"] = self.confirmednull
        if self.locus_index:
            dat_meta["locus_index"] = dict(self.locus_index)
        if self.factor0_idx is not None:
            dat_meta["factor0"] = {
                "column": self.factor0_idx - 3,       # among the columns after the parents
                "values": {r["id"]: r["factor0"] for r in self.records if not r.get("no_row")},
            }
        if self.parents_without_row:
            dat_meta["parents_without_row"] = list(self.parents_without_row)
        if founder_order is not None:
            dat_meta["founder_order"] = founder_order
        if supplied:
            dat_meta["supplied_ibd_rows"] = supplied
        if ibd:
            dat_meta["ibd_format"] = self._ibd_format()
        if self.source_founders:
            dat_meta["ibd_founders"] = "source"

        data = {
            "population": self.population or "",
            "ploidy": self.ploidy,
            "individuals": individuals,
            "traits": [trait_meta[name] for name, _ in self.trait_cols],
            "markers": [
                {
                    "name": name,
                    "linkage_group": self.markers[name]["lg"],
                    "position_cM": self.markers[name]["pos"],
                    "allele_names": self.markers[name]["allele_names"],
                    "founder_alleles": self.markers[name]["founder_alleles"],
                }
                for name in self.marker_order
            ],
            "ibd": ibd,
            "marker_codes": {
                iid: self.codes[iid] for iid in individuals if iid in self.codes
            },
            "dat_meta": dat_meta,
        }
        return PedigreeEngine.from_dict(data)


# ── Public API ────────────────────────────────────────────────────────────────

class PmpParser:
    @classmethod
    def from_dat_text(cls, dat_text: str) -> ParseResult:
        parser = _DatParser(dat_text)
        engine = parser.parse()
        return ParseResult(engine, parser.warnings)

    @classmethod
    def from_pmp_text(cls, pmp_text: str, dat_text: str) -> ParseResult:
        """Parse a .pmp + its .dat.

        The .pmp is the entry file (display config, subpopulations, views). The
        current engine has no model for views/subpopulations, so those are not
        loaded; we honor the population name if the .dat did not set one. The
        pedigree/marker/IBD data all come from the .dat.
        """
        result = cls.from_dat_text(dat_text)
        if not result.engine.population_name:
            name = _pmp_population_name(pmp_text)
            if name:
                result.engine.population_name = name
        return result


def _pmp_population_name(pmp_text: str) -> Optional[str]:
    """Best-effort: first [SUBPOP 0] 'Name <value>' line."""
    in_subpop0 = False
    for raw in pmp_text.splitlines():
        line = raw.strip()
        if line.startswith("[SUBPOP 0"):
            in_subpop0 = True
            continue
        if in_subpop0:
            if line.startswith("["):
                break
            if line.startswith("Name"):
                val = line[len("Name"):].strip()
                return _unquote(val) or None
    return None


# ── DAT exporter ──────────────────────────────────────────────────────────────

class DatExportError(ValueError):
    """Raised when the engine's state cannot be written as a valid .dat file."""


# Uniparental procreation types and the keyword written in place of the
# second parent (the inverse of _UNIPARENTAL).
_KEYWORD_FOR = {ct: f"*{kw}" for kw, ct in _UNIPARENTAL.items()}


def _fmt_number(v: Any) -> str:
    """Shortest text that reads back as exactly float(v), never in exponent form.

    repr() round-trips but can produce "1e-05", which the .dat number rule
    rejects, so it is re-rendered positionally through Decimal.
    """
    return format(Decimal(repr(float(v))), "f")


def _fmt_compact(v: Any) -> str:
    """Like _fmt_number, but integral values drop the ".0" (map positions, IBD)."""
    v = float(v)
    return str(int(v)) if v.is_integer() else _fmt_number(v)


def _quote(token: str, what: str) -> str:
    """Quote a token that would otherwise split on whitespace or start a comment."""
    if token == "" or re.search(r"[\s;]", token):
        if '"' in token:
            raise DatExportError(
                f"{what} {token!r} contains a double quote and a space or ';', "
                "which the .dat format cannot represent."
            )
        return f'"{token}"'
    return token


def _table(rows: List[List[str]]) -> List[str]:
    """Left-align columns, two spaces apart, with no trailing whitespace."""
    if not rows:
        return []
    ncols = max(len(r) for r in rows)
    widths = [max((len(r[c]) for r in rows if c < len(r)), default=0) for c in range(ncols)]
    return [
        "  ".join([cell.ljust(widths[c]) for c, cell in enumerate(r[:-1])] + r[-1:]).rstrip()
        for r in rows
    ]


# How a subset export treats parents that are not in the subset.
OUTSIDE_PARENTS_INCLUDE = "include"   # add them as founder rows (no link lost)
OUTSIDE_PARENTS_UNKNOWN = "unknown"   # write them as UNKNOWN (strictly closed set)


class DatExporter:
    @classmethod
    def to_dat_text(
        cls,
        engine: PedigreeEngine,
        ids: Optional[Iterable[str]] = None,
        *,
        outside_parents: str = OUTSIDE_PARENTS_INCLUDE,
        notes: Iterable[str] = (),
    ) -> str:
        """Write ``engine`` (or just the individuals in ``ids``) as ``.dat`` text.

        Header keywords use the values read from the source file; the pedigree
        keeps the original trait columns and row order; single-parent descent is
        written with *SELF / *DH / *MUT / *VP; names with spaces are quoted; and
        marker and IBD sections are written when present. For data read from a
        .dat file, parsing the result gives the same ``to_dict()``.

        When ``ids`` selects a subset, its parents that are not in the subset are
        handled by ``outside_parents``: "include" (default) adds them as founder
        rows — their own parents unknown, their trait/marker/IBD data kept — so
        no pedigree link is lost; "unknown" writes them as UNKNOWN instead. The
        header comment then records the source population and these counts.
        ``notes`` are extra header-comment lines (e.g. the selection criteria).

        Raises DatExportError if the data cannot be represented in the format.
        """
        return _DatWriter(engine, ids, outside_parents, notes).write()


class _DatWriter:
    def __init__(self, engine: PedigreeEngine, ids: Optional[Iterable[str]],
                 outside_parents: str = OUTSIDE_PARENTS_INCLUDE,
                 notes: Iterable[str] = ()) -> None:
        if outside_parents not in (OUTSIDE_PARENTS_INCLUDE, OUTSIDE_PARENTS_UNKNOWN):
            raise ValueError(f"outside_parents must be 'include' or 'unknown', "
                             f"not {outside_parents!r}")
        self.eng = engine
        self.notes = [" ".join(str(n).split()) for n in notes]   # one line each
        meta = engine.dat_meta or {}
        self.unknown: List[str] = list(meta.get("unknown") or ["-"])
        self.missing = self.unknown[0]          # first symbol is the display form
        self.nullhomoz: str = meta.get("nullhomoz") or "$"

        labels = list(meta.get("parent_columns") or [])
        if len(labels) != 2 or (labels[0].upper(), labels[1].upper()) not in _PARENT_ALIASES:
            labels = ["FEMALE", "MALE"]
        self.parent_labels = labels
        self.female_first = _PARENT_ALIASES[(labels[0].upper(), labels[1].upper())]

        # Row order: the source file's order where known — trait categories are
        # numbered by first appearance, so this makes them read back identically
        # — followed by anything added since, in engine order.
        known = set(engine.all_ids())
        source = [i for i in meta.get("source_order", []) if i in known]
        listed = set(source)
        order = source + [i for i in engine.all_ids() if i not in listed]

        # Subset: individuals selected, plus (in "include" mode) their parents
        # that fall outside the selection, written as founder rows.
        self.subset: Optional[Dict[str, Any]] = None
        self.as_founders: set = set()
        if ids is not None:
            wanted = set(ids)
            stray = wanted - known
            if stray:
                raise DatExportError(f"Unknown individual(s): {', '.join(sorted(stray))}.")
            outside = {
                p for i in wanted
                for p in (engine.get(i).female_parent, engine.get(i).male_parent)
                if p is not None and p in known and p not in wanted
            }
            if outside_parents == OUTSIDE_PARENTS_INCLUDE:
                self.as_founders = outside
            self.subset = {"selected": len(wanted), "outside": len(outside),
                           "mode": outside_parents}
            order = [i for i in order if i in wanted or i in self.as_founders]
        if not order:
            raise DatExportError("There are no individuals to export.")
        self.order = order
        self.included = set(order)

        # .dat identifies individuals by NAME. For .dat-sourced data id == name;
        # for other sources (sample data, JSON) use the names when they are
        # unique, otherwise fall back to the ids.
        names = [engine.get(i).name for i in order]
        if all(names) and len(set(names)) == len(names):
            self.label = {i: engine.get(i).name for i in order}
        else:
            self.label = {i: i for i in order}

        # NALLELES as read; data without dat_meta (older JSON) takes it from IBD.
        # A file read without a NALLELES line is written without one.
        self.write_nalleles = not ("nalleles" in meta and meta["nalleles"] is None)
        self.nalleles = int(meta.get("nalleles") or 0)
        if not self.nalleles:
            for by_pos in engine.ibd.values():
                for rows in by_pos.values():
                    for homologues in rows.values():
                        if homologues:
                            self.nalleles = len(homologues[0])
                            break
        self.confirmednull: Optional[str] = meta.get("confirmednull")
        self.locus_index: Dict[str, int] = meta.get("locus_index") or {}
        self.factor0_column: Optional[int] = (meta.get("factor0") or {}).get("column")
        # A subset's IBD rows refer to the founder alleles of the population it
        # comes from: say so, and write every row (see _IBDFOUNDERS_RE). A whole
        # population leaves out the founder rows the parser supplied, as read.
        self.source_founders = bool(self.nalleles) and (
            self.subset is not None or meta.get("ibd_founders") == "source")
        self.supplied: Dict[str, Dict[str, List[str]]] = (
            {} if self.source_founders else meta.get("supplied_ibd_rows") or {})
        self.ibd_order: List[Tuple[str, List[str]]] = []   # IBDPOSITIONS lines as written
        # Probabilities are written as they were read ("0", "1.0", "0.00", ...),
        # so the rounding tolerance of their sums (spec 5.6) stays the same.
        self.ibd_format: Optional[Dict[str, Any]] = meta.get("ibd_format")

    # -- cells --
    def _name(self, iid: str) -> str:
        return _quote(self.label[iid], "Individual name")

    def _ref(self, pid: Optional[str]) -> str:
        return self._name(pid) if pid in self.included else self.missing

    def _parent_cells(self, ind: Individual) -> Tuple[str, str]:
        if ind.id in self.as_founders:          # outside parent added to a subset
            return self.missing, self.missing
        keyword = _KEYWORD_FOR.get(ind.cross_type)
        if keyword:
            # Single-parent descent: the parent, then the keyword. A self keeps
            # its parent in both fields; the others keep it in female_parent.
            return self._ref(ind.female_parent or ind.male_parent), keyword
        f, m = self._ref(ind.female_parent), self._ref(ind.male_parent)
        return (f, m) if self.female_first else (m, f)

    def _trait_cell(self, ind: Individual, trait: TraitMeta) -> str:
        value = ind.traits.get(trait.name)
        if value is None:
            return self.missing
        if trait.trait_type == TraitType.CONTINUOUS:
            try:
                text = _fmt_number(value)
            except (TypeError, ValueError, ArithmeticError):
                raise DatExportError(
                    f"{ind.id}: value {value!r} of continuous trait {trait.name!r} "
                    "is not a number."
                ) from None
        else:
            text = str(value)
        if text in self.unknown:
            raise DatExportError(
                f"{ind.id}: value {text!r} of trait {trait.name!r} is an UNKNOWN "
                "symbol and would read back as missing."
            )
        return _quote(text, f"Value of trait {trait.name!r}")

    # -- sections --
    def _comments(self) -> List[str]:
        lines = ["Exported by Pedimap 2"]
        if self.subset is not None:
            lines.append(f"Subpopulation of: {self.eng.population_name or '(unnamed population)'}")
        lines += self.notes
        if self.subset is not None:
            s = self.subset
            if s["mode"] == OUTSIDE_PARENTS_INCLUDE:
                handled = f"{s['outside']} outside parent(s) added as founder rows"
            else:
                handled = f"{s['outside']} outside parent(s) replaced with unknown"
            lines.append(f"Individuals: {s['selected']} selected; {handled}")
        # Record each trait's type so the file reads back with it even if the
        # values that remain (e.g. in a subset) would be inferred differently.
        lines += [f"PEDIMAP2 TRAITTYPE {_quote(t.name, 'Trait name')} "
                  f"{_WRITTEN_TYPE[t.trait_type]}" for t in self.eng.traits]
        if self.source_founders:
            lines.append(_IBDFOUNDERS_LINE)
        return [f"; {line}" for line in lines]

    def write(self) -> str:
        lines = self._comments() + [""]
        lines += self._header()
        lines += ["", "PEDIGREE"] + self._pedigree()
        lines += self._linkage_groups()
        lines += self._observed_alleles()
        lines += self._ibd()
        return "\n".join(lines) + "\n"

    def _header(self) -> List[str]:
        rows = []
        if self.eng.population_name:
            rows.append(["POPULATION", "=", self.eng.population_name])
        rows += [
            ["UNKNOWN",   "=", " ".join(self.unknown)],
            ["NULLHOMOZ", "=", self.nullhomoz],
        ]
        if self.confirmednull is not None:
            rows.append(["CONFIRMEDNULL", "=", self.confirmednull])
        if self.write_nalleles:
            rows.append(["NALLELES", "=", str(self.nalleles)])
        rows.append(["PLOIDY", "=", str(self.eng.ploidy)])
        return _table(rows)

    def _pedigree(self) -> List[str]:
        traits = self.eng.traits
        caption = [_quote(t.name, "Trait name") for t in traits]
        cells = {}
        for iid in self.order:
            ind = self.eng.get(iid)
            cells[iid] = ([self._name(iid), *self._parent_cells(ind)]
                          + [self._trait_cell(ind, t) for t in traits])
        if self.factor0_column is not None:
            # FACTOR0 where the source had it, computed from the pedigree as
            # written (a subset's founders differ from its source's).
            at = min(self.factor0_column, len(traits))
            caption.insert(at, _FACTOR0)
            parents = {c for row in cells.values() for c in row[1:3]}
            for iid, row in cells.items():
                founder = row[1] == self.missing and row[2] == self.missing
                row.insert(3 + at, "0" if founder else "1" if row[0] in parents else "2")
        rows = [["NAME", *self.parent_labels] + caption] + [cells[iid] for iid in self.order]
        return _table(rows)

    def _lg_line(self, lg: str) -> str:
        return f"LINKAGEGROUP {_quote(lg, 'Linkage group')}" if lg else "LINKAGEGROUP"

    def _linkage_groups(self) -> List[str]:
        eng = self.eng
        positions = {lg: list(p) for lg, p in
                     ((eng.dat_meta or {}).get("ibd_positions") or {}).items()}
        for lg, by_pos in eng.ibd.items():
            positions.setdefault(lg, list(by_pos))

        # One LINKAGEGROUP block per run of consecutive markers sharing a group,
        # so the markers read back in the same order.
        runs: List[Tuple[str, List[MarkerMeta]]] = []
        for m in eng.markers:
            if runs and runs[-1][0] == m.linkage_group:
                runs[-1][1].append(m)
            else:
                runs.append((m.linkage_group, [m]))

        out: List[str] = []
        done: set = set()
        for lg, markers in runs:
            out += ["", self._lg_line(lg), "", "MAP"]
            out += _table([[_quote(m.name, "Marker name"), _fmt_compact(m.position_cM)]
                           for m in markers])
            for m in markers:
                if not (m.allele_names or m.founder_alleles):
                    continue
                index = self.locus_index.get(m.name)
                out += ["", f"LOCUS {_quote(m.name, 'Marker name')}"
                            + (f" ({index})" if index is not None else "")]
                if m.allele_names:
                    out.append("ALLELENAMES " + " ".join(
                        _quote(a, "Allele name") for a in m.allele_names))
                if m.founder_alleles:
                    out.append("FOUNDERALLELES " + " ".join(
                        _quote(a, "Allele name") for a in m.founder_alleles))
            if lg in positions and lg not in done:
                out += ["", "IBDPOSITIONS " + " ".join(positions[lg])]
                self.ibd_order.append((lg, positions[lg]))
                done.add(lg)
        # Groups that carry IBD data but no markers (the "IBD only" subset).
        for lg, pos in positions.items():
            if lg not in done:
                out += ["", self._lg_line(lg), "", "IBDPOSITIONS " + " ".join(pos)]
                self.ibd_order.append((lg, pos))
        return out

    def _observed_alleles(self) -> List[str]:
        eng = self.eng
        individuals = [eng.get(i) for i in self.order]
        present = {mk for ind in individuals for mk in ind.markers}
        # Map order first, then any marker that only appears in ALLELES data.
        markers = [m.name for m in eng.markers if m.name in present]
        for ind in individuals:
            markers += [mk for mk in ind.markers if mk not in markers]
        lg_of = {m.name: m.linkage_group for m in eng.markers}

        out: List[str] = []
        for mk in markers:
            rows = []
            for ind in individuals:
                alleles = ind.markers.get(mk)
                if alleles is None:
                    continue
                codes = list(eng.marker_codes.get(ind.id, {}).get(mk, []))
                codes += ["0"] * (len(alleles) - len(codes))
                cells = [self._name(ind.id)]
                for allele, code in zip(alleles, codes):
                    cells += [_quote(str(allele), "Allele"), str(code)]
                rows.append(cells)
            note = f" ; LG {lg_of[mk]}" if lg_of.get(mk) else ""
            out += ["", f"ALLELES {_quote(mk, 'Marker name')}{note}"] + _table(rows)
        return out

    def _ibd_sections(self) -> List[Tuple[str, str, Dict[str, Any]]]:
        """(group, position, rows) in the order of the IBDPOSITIONS lines written,
        which is the order a reader assigns the sections by (spec 5.5)."""
        sections = []
        for lg, positions in self.ibd_order:
            by_pos = self.eng.ibd.get(lg, {})
            unused = dict(by_pos)
            for listed in positions:
                key = next((k for k in unused if abs(float(k) - float(listed)) <= 1e-6), None)
                if key is None:
                    raise DatExportError(f"IBD position {listed} of linkage group {lg!r} has "
                                         "no IBD data.")
                sections.append((lg, key, unused.pop(key)))
            if unused:
                raise DatExportError(f"IBD data for linkage group {lg!r} at {next(iter(unused))} "
                                     "is not on its IBDPOSITIONS line.")
        return sections

    def _probability(self, lg: str, pos: str, iid: str, j: int, v: float) -> str:
        fmt = self.ibd_format
        if fmt is None:
            return _fmt_compact(v)
        token = fmt.get("tokens", {}).get(lg, {}).get(pos, {}).get(iid, {}).get(str(j))
        if token is not None and float(token) == v:
            return token
        return _probability_token(float(v), fmt)

    def _ibd(self) -> List[str]:
        eng = self.eng
        out: List[str] = []
        for lg, pos, by_ind in self._ibd_sections():
            if not lg or re.search(r"\s", lg):
                raise DatExportError(
                    f"IBD linkage group {lg!r} cannot be written as an IBDPOSITION annotation."
                )
            absent = [i for i in self.order if i not in by_ind]
            if absent:
                raise DatExportError(
                    f"IBD data for LG {lg} position {pos} is missing for "
                    f"{len(absent)} individual(s) (e.g. {absent[0]!r}); every "
                    "exported individual must appear in every IBD section."
                )
            supplied = set(self.supplied.get(lg, {}).get(pos, []))
            rows = []
            for iid, homologues in by_ind.items():   # keep the original row order
                if iid not in self.included or iid in supplied:
                    continue
                if (len(homologues) != eng.ploidy
                        or any(len(h) != self.nalleles for h in homologues)):
                    raise DatExportError(
                        f"IBD data for {iid!r} (LG {lg}, pos {pos}) is not "
                        f"{eng.ploidy} x {self.nalleles} probabilities."
                    )
                values = [v for h in homologues for v in h]
                rows.append([self._name(iid)] + [self._probability(lg, pos, iid, j, v)
                                                 for j, v in enumerate(values)])
            out += ["", f"IBDPOSITION {pos} ; LG {lg}"] + _table(rows)
        return out
