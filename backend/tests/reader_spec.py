"""
Maps a parsed engine onto the expected-content layout of the FlexQTL/Binko
reader specification (docs/reference/flexqtl-binko-pedimap/README.md, "Layout
of the expected JSON"), and compares two such contents.

The layout states what a file says, row by row: a founder row the parser
supplied (a Binko dummy founder has no IBD rows) is left out, as it is absent
from the file, and the parents without a row are listed apart.
"""
import gzip
import json
import math
import os
from typing import Any, List, Optional

from pedigree_engine import PedigreeEngine, TraitType
from pmp_parser import _PARENT_ALIASES

FORMAT = "pedimap2-reader-spec/expected-content/1"
FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "flexqtl_binko")
TOLERANCE = 1e-9


def read_fixture(name: str) -> str:
    """The text of a fixture, stored gzip-compressed when large."""
    path = os.path.join(FIXTURES, name)
    if os.path.exists(path + ".gz"):
        with gzip.open(path + ".gz", "rt", encoding="utf-8", newline="") as fh:
            return fh.read()
    with open(path, encoding="utf-8", newline="") as fh:
        return fh.read()


def expected(name: str) -> dict:
    """The spec's expected content of fixture ``name`` (e.g. "binko_ibd.ped")."""
    return json.loads(read_fixture(name.rsplit(".", 1)[0] + ".expected.json"))


def content(engine: PedigreeEngine, fixture: str) -> dict:
    meta = engine.dat_meta
    unknown = meta.get("unknown") or ["-"]
    no_row = list(meta.get("parents_without_row", []))
    order = list(meta.get("source_order") or engine.all_ids())
    table = [iid for iid in order if iid not in set(no_row)]

    # ── pedigree ──
    factor0 = meta.get("factor0")
    columns = [t.name for t in engine.traits]
    if factor0:
        columns.insert(factor0["column"], "FACTOR0")
    labels = meta.get("parent_columns") or ["FEMALE", "MALE"]
    female_first = _PARENT_ALIASES[(labels[0].upper(), labels[1].upper())]
    individuals = []
    for iid in table:
        ind = engine.get(iid)
        p1, p2 = ((ind.female_parent, ind.male_parent) if female_first
                  else (ind.male_parent, ind.female_parent))
        values: List[Any] = []
        for trait in engine.traits:
            v = ind.traits.get(trait.name)
            values.append(None if v is None else
                          float(v) if trait.trait_type == TraitType.CONTINUOUS else str(v))
        token = factor0["values"].get(iid) if factor0 else None
        if factor0:
            values.insert(factor0["column"], token)
        individuals.append({
            "name": iid, "parent1": p1, "parent2": p2,
            "factor0": int(token) if token is not None and token.isdigit() else None,
            "values": values,
        })

    # ── linkage groups ──
    positions = meta.get("ibd_positions") or {}
    index = meta.get("locus_index") or {}
    groups: List[str] = []
    for m in engine.markers:
        if m.linkage_group not in groups:
            groups.append(m.linkage_group)
    groups += [g for g in positions if g not in groups]
    linkage_groups = [{
        "name": g,
        "markers": [{
            "name": m.name,
            "index": index.get(m.name),
            "position_cM": m.position_cM,
            "allele_names": list(m.allele_names) or None,
            "founder_alleles": ([None if a in unknown else a for a in m.founder_alleles]
                                or None),
        } for m in engine.markers if m.linkage_group == g],
        "ibd_positions_cM": [float(p) for p in positions[g]] if g in positions else None,
    } for g in groups]

    # ── genotypes ──
    genotypes = []
    for m in engine.markers:
        rows = []
        for iid in order:
            alleles = engine.get(iid).markers.get(m.name)
            if alleles is None:
                continue
            codes = engine.marker_codes.get(iid, {}).get(m.name, [])
            row: List[Any] = [iid]
            for allele, code in zip(alleles, codes):
                row += [None if allele in unknown else allele, code]
            rows.append(row)
        if rows:
            genotypes.append({"marker": m.name, "rows": rows})

    # ── IBD ──
    nalleles = meta.get("nalleles")
    ibd = None
    if nalleles:
        supplied = meta.get("supplied_ibd_rows") or {}
        founder_order = meta.get("founder_order") or []
        ibd = {
            "nalleles": nalleles,
            "founder_alleles": [{"number": 2 * k + h + 1, "founder": f, "homologue": h + 1}
                                for k, f in enumerate(founder_order) for h in range(2)],
            "positions": [{
                "linkage_group": g,
                "position_cM": float(pos),
                "rows": [{"name": iid, "h1": hs[0], "h2": hs[1]} for iid, hs in rows.items()
                         if iid not in supplied.get(g, {}).get(pos, [])],
            } for g, by_pos in engine.ibd.items() for pos, rows in by_pos.items()],
        }

    founders = [iid for iid in order
                if engine.get(iid).female_parent is None and engine.get(iid).male_parent is None]
    return {
        "format": FORMAT,
        "fixture": fixture,
        "settings": {
            "POPULATION": engine.population_name or None,
            "UNKNOWN": list(unknown),
            "NULLHOMOZ": meta.get("nullhomoz", "$"),
            "CONFIRMEDNULL": meta.get("confirmednull", "null"),
            "PLOIDY": engine.ploidy,
            "NALLELES": nalleles,
        },
        "pedigree": {
            "caption": ["NAME", *labels, *columns],
            "columns": columns,
            "individuals": individuals,
            "parents_without_row": no_row,
        },
        "linkage_groups": linkage_groups,
        "genotypes": genotypes,
        "ibd": ibd,
        "counts": {
            "individuals": len(table),
            "founders": len(founders),
            "linkage_groups": len(linkage_groups),
            "markers": len(engine.markers),
            "genotype_sections": len(genotypes),
            "genotype_rows": sum(len(s["rows"]) for s in genotypes),
            "ibd_positions": len(ibd["positions"]) if ibd else 0,
            "ibd_rows": sum(len(p["rows"]) for p in ibd["positions"]) if ibd else 0,
        },
    }


def _number(x: Any) -> Optional[float]:
    if isinstance(x, bool):
        return None
    if isinstance(x, (int, float)):
        return float(x)
    if isinstance(x, str):
        try:
            return float(x)
        except ValueError:
            return None
    return None


def difference(want: Any, got: Any, path: str = "") -> Optional[str]:
    """The first place where ``got`` differs from ``want``, or None.

    Numbers are equal within 1e-9; a value the spec keeps as a string (a trait
    value) equals the number the parser made of it.
    """
    if isinstance(want, dict) and isinstance(got, dict):
        if set(want) != set(got):
            return f"{path}: keys {sorted(set(want) ^ set(got))} differ"
        for k in want:
            d = difference(want[k], got[k], f"{path}.{k}")
            if d:
                return d
        return None
    if isinstance(want, list) and isinstance(got, list):
        if len(want) != len(got):
            return f"{path}: {len(want)} entries expected, {len(got)} found"
        for k, (w, g) in enumerate(zip(want, got)):
            d = difference(w, g, f"{path}[{k}]")
            if d:
                return d
        return None
    if want == got and type(want) is type(got):
        return None
    a, b = _number(want), _number(got)
    if (a is not None and b is not None and not (isinstance(want, str) and isinstance(got, str))
            and math.isclose(a, b, rel_tol=0, abs_tol=TOLERANCE)):
        return None
    return f"{path}: expected {want!r}, found {got!r}"
