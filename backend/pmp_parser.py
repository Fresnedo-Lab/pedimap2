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

# Uniparental (single-parent) procreation keywords, second-parent column.
_UNIPARENTAL = {
    "SELF": CrossType.SELF,
    "DH":   CrossType.DOUBLED_HAPLOID,
    "VP":   CrossType.CLONE,
    "MUT":  CrossType.MUTANT,
}

# IBD homologue probabilities are given to 2 decimals, so a row of up to N
# values can accumulate rounding error; allow a small tolerance around 1.0.
_IBD_SUM_TOL = 0.05

# Section keywords that begin a new block (case-insensitive).
_SECTION_KEYWORDS = {
    "PEDIGREE", "LINKAGEGROUP", "MAP", "LOCUS", "ALLELENAMES",
    "FOUNDERALLELES", "IBDPOSITIONS", "ALLELES", "IBDPOSITION",
}
_HEADER_KEYS = {"POPULATION", "UNKNOWN", "NULLHOMOZ", "NALLELES", "PLOIDY"}

# Parent-column caption aliases -> which physical column is female / male.
# value is (female_first: bool)
_PARENT_ALIASES = {
    ("FEMALE", "MALE"):     True,
    ("MOTHER", "FATHER"):   True,
    ("MALE", "FEMALE"):     False,
    ("FATHER", "MOTHER"):   False,
    ("PARENT1", "PARENT2"): True,   # neutral: treat p1 as "female slot", no sex asserted
}


class DatParseError(ValueError):
    """Raised for any malformed .dat input, with a human-readable message."""


class ParseResult:
    def __init__(self, engine: PedigreeEngine) -> None:
        self.engine = engine


# ── Lexing helpers ────────────────────────────────────────────────────────────

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
    """'LG A' -> 'A'; 'A' -> 'A'; None -> None."""
    if not annot:
        return None
    m = re.search(r"LG\s+(\S+)", annot)
    if m:
        return m.group(1)
    return annot.split()[0] if annot.split() else None


# ── DAT parser ────────────────────────────────────────────────────────────────

class _DatParser:
    def __init__(self, text: str) -> None:
        self.lines = text.splitlines()
        self.n = len(self.lines)
        self.i = 0

        # header
        self.population: Optional[str] = None
        self.ploidy = 2
        self.nalleles = 0
        self.unknown = ["-"]
        self.nullhomoz = "$"
        self._pedigree_started = False

        # pedigree
        self.female_first = True
        self.female_idx = 0
        self.male_idx = 1
        self.parent_labels: List[str] = ["FEMALE", "MALE"]   # caption cols 2-3 as read
        self.trait_cols: List[Tuple[str, int]] = []   # (name, col index after NAME)
        self.records: List[dict] = []                 # ordered raw individuals
        self.ids: List[str] = []
        self.id_set: set = set()

        # markers
        self.current_lg: Optional[str] = None
        self.current_locus: Optional[str] = None
        self.markers: Dict[str, dict] = {}            # name -> {lg,pos,allele_names,founder_alleles}
        self.marker_order: List[str] = []
        self.ibd_positions: Dict[str, List[str]] = {}
        self.observed: Dict[str, Dict[str, List[str]]] = {}
        self.codes: Dict[str, Dict[str, List[str]]] = {}      # parallel color codes

        # ibd
        self.ibd: Dict[str, Dict[str, Dict[str, List[List[float]]]]] = {}

    # -- line helpers --
    def _clean(self, raw: str) -> str:
        return _strip_comment(raw).strip()

    def _first_key(self, cleaned: str) -> Optional[str]:
        if not cleaned:
            return None
        return _tokenize(cleaned)[0].upper()

    def _is_block_boundary(self, cleaned: str) -> bool:
        key = self._first_key(cleaned)
        return key in _SECTION_KEYWORDS or (
            not self._pedigree_started and key in _HEADER_KEYS
        )

    # -- main --
    def parse(self) -> PedigreeEngine:
        while self.i < self.n:
            raw = self.lines[self.i]
            cleaned = self._clean(raw)
            if not cleaned:
                self.i += 1
                continue
            key = self._first_key(cleaned)

            if not self._pedigree_started and key in _HEADER_KEYS:
                self._parse_header(cleaned)
                self.i += 1
                continue
            if key == "PEDIGREE":
                self.i += 1
                self._parse_pedigree()
                continue
            if key == "LINKAGEGROUP":
                self.current_lg = _tokenize(cleaned)[1] if len(_tokenize(cleaned)) > 1 else ""
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
                self._set_locus_field("founder_alleles", _tokenize(cleaned)[1:])
                self.i += 1
                continue
            if key == "IBDPOSITIONS":
                if self.current_lg is not None:
                    self.ibd_positions[self.current_lg] = _tokenize(cleaned)[1:]
                self.i += 1
                continue
            if key == "ALLELES":
                marker = _tokenize(cleaned)[1]
                self.i += 1
                self._parse_observed(marker)
                continue
            if key == "IBDPOSITION":
                self._parse_ibd_block(raw)
                continue

            # Unknown line outside any known section: skip defensively.
            self.i += 1

        return self._build_engine()

    # -- header --
    def _parse_header(self, cleaned: str) -> None:
        key = self._first_key(cleaned)
        rest = cleaned[len(_tokenize(cleaned)[0]):].strip()
        if rest.startswith("="):
            rest = rest[1:].strip()
        vals = rest.split()
        if key == "POPULATION":
            self.population = rest or None
        elif key == "UNKNOWN":
            self.unknown = vals or ["-"]
        elif key == "NULLHOMOZ":
            self.nullhomoz = vals[0] if vals else "$"
        elif key == "NALLELES":
            self.nalleles = int(vals[0]) if vals and vals[0].isdigit() else 0
        elif key == "PLOIDY":
            self.ploidy = int(vals[0]) if vals and vals[0].isdigit() else 2

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
            raise DatParseError(
                f"Pedigree caption must start with NAME (got: {caption!r})."
            )
        if len(cols) < 3:
            raise DatParseError("Pedigree caption needs NAME + two parent columns.")

        pa, pb = cols[1].upper(), cols[2].upper()
        if (pa, pb) not in _PARENT_ALIASES:
            raise DatParseError(
                f"Unrecognized parent columns {cols[1]!r}/{cols[2]!r}. Expected one of "
                "FEMALE/MALE, MOTHER/FATHER, PARENT1/PARENT2 (either order)."
            )
        self.female_first = _PARENT_ALIASES[(pa, pb)]
        self.parent_labels = [cols[1], cols[2]]
        # physical column indices (0-based, within the whole row incl. NAME at 0)
        self.female_idx = 1 if self.female_first else 2
        self.male_idx = 2 if self.female_first else 1
        self.trait_cols = [(name, 3 + k) for k, name in enumerate(cols[3:])]

        # data rows
        while self.i < self.n:
            cleaned = self._clean(self.lines[self.i])
            if not cleaned:
                self.i += 1
                continue
            if self._is_block_boundary(cleaned):
                break
            self._parse_pedigree_row(_tokenize(cleaned), cleaned)
            self.i += 1

    def _parse_pedigree_row(self, toks: List[str], cleaned: str) -> None:
        if len(toks) < 3:
            raise DatParseError(f"Malformed pedigree row: {cleaned!r}")
        ind_id = toks[0]
        if ind_id in self.id_set:
            raise DatParseError(f"Duplicate individual name: {ind_id!r}")
        f_tok = toks[self.female_idx]
        m_tok = toks[self.male_idx]
        raw_traits: Dict[str, str] = {}
        for name, idx in self.trait_cols:
            if idx < len(toks):
                val = toks[idx]
                if val not in self.unknown:
                    raw_traits[name] = val
        self.records.append({
            "id": ind_id, "f_tok": f_tok, "m_tok": m_tok, "raw_traits": raw_traits,
        })
        self.ids.append(ind_id)
        self.id_set.add(ind_id)

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
            marker = toks[0]
            pos = float(toks[1]) if len(toks) > 1 and _is_number(toks[1]) else 0.0
            self._ensure_marker(marker)
            self.markers[marker]["lg"] = self.current_lg or ""
            self.markers[marker]["pos"] = pos
            self.i += 1

    def _ensure_marker(self, marker: str) -> None:
        if marker not in self.markers:
            self.markers[marker] = {
                "lg": self.current_lg or "", "pos": 0.0,
                "allele_names": [], "founder_alleles": [],
            }
            self.marker_order.append(marker)

    def _begin_locus(self, toks: List[str]) -> None:
        if len(toks) < 2:
            raise DatParseError("LOCUS statement needs a marker name.")
        self.current_locus = toks[1]
        self._ensure_marker(self.current_locus)

    def _set_locus_field(self, field: str, values: List[str]) -> None:
        if self.current_locus is None:
            raise DatParseError(f"{field} statement outside of a LOCUS.")
        self.markers[self.current_locus][field] = values

    def _parse_observed(self, marker: str) -> None:
        while self.i < self.n:
            cleaned = self._clean(self.lines[self.i])
            if not cleaned:
                self.i += 1
                continue
            if self._is_block_boundary(cleaned):
                break
            toks = _tokenize(cleaned)
            ind = toks[0]
            rest = toks[1:]
            # rest is (allele, colorcode) pairs.
            alleles = rest[0::2][:self.ploidy]
            self.observed.setdefault(ind, {})[marker] = alleles
            self.codes.setdefault(ind, {})[marker] = rest[1::2][:self.ploidy]
            self.i += 1

    # -- ibd --
    def _parse_ibd_block(self, raw: str) -> None:
        main, annot = _split_annotation(raw)
        mtoks = _tokenize(self._clean(main))  # main has no ';'; safe to clean
        pos = mtoks[1] if len(mtoks) > 1 else "0"
        lg = _lg_from_annotation(annot) or self.current_lg
        if lg is None:
            raise DatParseError(f"IBDPOSITION with no linkage group: {raw.strip()!r}")
        self.i += 1

        if self.nalleles <= 0:
            raise DatParseError(
                "IBD section present but NALLELES is 0/absent; cannot size the "
                "founder-allele probability vectors."
            )
        expected = self.ploidy * self.nalleles
        block: Dict[str, List[List[float]]] = {}
        while self.i < self.n:
            cleaned = self._clean(self.lines[self.i])
            if not cleaned:
                self.i += 1
                continue
            if self._is_block_boundary(cleaned):
                break
            toks = _tokenize(cleaned)
            ind = toks[0]
            vals = toks[1:]
            if ind not in self.id_set:
                raise DatParseError(
                    f"IBD section (LG {lg}, pos {pos}) lists unknown individual {ind!r}."
                )
            if len(vals) != expected:
                raise DatParseError(
                    f"IBD row for {ind!r} (LG {lg}, pos {pos}) has {len(vals)} values, "
                    f"expected {expected} (= ploidy {self.ploidy} x NALLELES {self.nalleles}); "
                    "missing data is not permitted in IBD sections."
                )
            if not all(_is_number(v) for v in vals):
                raise DatParseError(
                    f"IBD row for {ind!r} (LG {lg}, pos {pos}) contains non-numeric data."
                )
            nums = [float(v) for v in vals]
            homologues = [
                nums[h * self.nalleles:(h + 1) * self.nalleles]
                for h in range(self.ploidy)
            ]
            for h, vec in enumerate(homologues):
                s = sum(vec)
                if abs(s - 1.0) > _IBD_SUM_TOL:
                    raise DatParseError(
                        f"IBD homologue {h + 1} for {ind!r} (LG {lg}, pos {pos}) sums to "
                        f"{s:.3f}, not 1.0."
                    )
            block[ind] = homologues
            self.i += 1

        # Completeness: every pedigree individual must appear in the section.
        missing = self.id_set - set(block.keys())
        if missing:
            raise DatParseError(
                f"IBD section (LG {lg}, pos {pos}) is missing individuals: "
                f"{', '.join(sorted(missing))}."
            )
        self.ibd.setdefault(lg, {})[str(pos)] = block

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

    def _infer_traits(self) -> Dict[str, dict]:
        """Return {trait_name: TraitMeta-dict} applying the documented rule."""
        meta: Dict[str, dict] = {}
        for name, _idx in self.trait_cols:
            vals = [r["raw_traits"][name] for r in self.records if name in r["raw_traits"]]
            if not vals:
                meta[name] = {"name": name, "type": "qualitative", "categories": []}
                continue
            all_single = all(len(v) == 1 for v in vals)
            any_non_number = any(not _is_number(v) for v in vals)
            discrete = all_single or any_non_number
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

        # Validate parent references (names are case-sensitive, must resolve).
        for iid, idata in individuals.items():
            for pcol in ("female_parent", "male_parent"):
                p = idata[pcol]
                if p is not None and p not in individuals:
                    raise DatParseError(
                        f"Individual {iid!r} references unknown {pcol} {p!r}."
                    )

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

        # Stable topological order: every individual follows its parents, with
        # ties broken by original file appearance so full-sib order is preserved
        # (dat-format spec §5). The file may list a child before its parents.
        order = self._stable_topo_order(individuals)
        individuals = {iid: individuals[iid] for iid in order}

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
            "ibd": self.ibd,
            "marker_codes": {
                iid: self.codes[iid] for iid in individuals if iid in self.codes
            },
            "dat_meta": {
                "unknown":        list(self.unknown),
                "nullhomoz":      self.nullhomoz,
                "nalleles":       self.nalleles,
                "parent_columns": list(self.parent_labels),
                "source_order":   list(self.ids),
                "ibd_positions":  {lg: list(p) for lg, p in self.ibd_positions.items()},
            },
        }
        return PedigreeEngine.from_dict(data)


# ── Public API ────────────────────────────────────────────────────────────────

class PmpParser:
    @classmethod
    def from_dat_text(cls, dat_text: str) -> ParseResult:
        return ParseResult(_DatParser(dat_text).parse())

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
        self.nalleles = int(meta.get("nalleles") or 0)
        if not self.nalleles:
            for by_pos in engine.ibd.values():
                for rows in by_pos.values():
                    for homologues in rows.values():
                        if homologues:
                            self.nalleles = len(homologues[0])
                            break

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
            ["NALLELES",  "=", str(self.nalleles)],
            ["PLOIDY",    "=", str(self.eng.ploidy)],
        ]
        return _table(rows)

    def _pedigree(self) -> List[str]:
        traits = self.eng.traits
        rows = [["NAME", *self.parent_labels] + [_quote(t.name, "Trait name") for t in traits]]
        for iid in self.order:
            ind = self.eng.get(iid)
            rows.append([self._name(iid), *self._parent_cells(ind)]
                        + [self._trait_cell(ind, t) for t in traits])
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
                out += ["", f"LOCUS {_quote(m.name, 'Marker name')}"]
                if m.allele_names:
                    out.append("ALLELENAMES " + " ".join(
                        _quote(a, "Allele name") for a in m.allele_names))
                if m.founder_alleles:
                    out.append("FOUNDERALLELES " + " ".join(
                        _quote(a, "Allele name") for a in m.founder_alleles))
            if lg in positions and lg not in done:
                out += ["", "IBDPOSITIONS " + " ".join(positions[lg])]
                done.add(lg)
        # Groups that carry IBD data but no markers (the "IBD only" subset).
        for lg, pos in positions.items():
            if lg not in done:
                out += ["", self._lg_line(lg), "", "IBDPOSITIONS " + " ".join(pos)]
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

    def _ibd(self) -> List[str]:
        eng = self.eng
        out: List[str] = []
        for lg, by_pos in eng.ibd.items():
            if not lg or re.search(r"\s", lg):
                raise DatExportError(
                    f"IBD linkage group {lg!r} cannot be written as an IBDPOSITION annotation."
                )
            for pos, by_ind in by_pos.items():
                absent = [i for i in self.order if i not in by_ind]
                if absent:
                    raise DatExportError(
                        f"IBD data for LG {lg} position {pos} is missing for "
                        f"{len(absent)} individual(s) (e.g. {absent[0]!r}); every "
                        "exported individual must appear in every IBD section."
                    )
                rows = []
                for iid, homologues in by_ind.items():   # keep the original row order
                    if iid not in self.included:
                        continue
                    if (len(homologues) != eng.ploidy
                            or any(len(h) != self.nalleles for h in homologues)):
                        raise DatExportError(
                            f"IBD data for {iid!r} (LG {lg}, pos {pos}) is not "
                            f"{eng.ploidy} x {self.nalleles} probabilities."
                        )
                    rows.append([self._name(iid)]
                                + [_fmt_compact(v) for h in homologues for v in h])
                out += ["", f"IBDPOSITION {pos} ; LG {lg}"] + _table(rows)
        return out
