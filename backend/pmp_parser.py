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
Both return a ParseResult whose ``.engine`` is a populated PedigreeEngine.
"""
from __future__ import annotations

import heapq
import re
from typing import Any, Dict, List, Optional, Tuple

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
            # rest is (allele, colorcode) pairs; keep allele names only.
            alleles = rest[0::2][:self.ploidy]
            self.observed.setdefault(ind, {})[marker] = alleles
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
        }
        engine = PedigreeEngine.from_dict(data)
        engine.ibd = self.ibd
        return engine


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
