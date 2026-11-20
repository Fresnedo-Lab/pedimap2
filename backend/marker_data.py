"""
marker_data.py  –  Pedimap 2
=============================
The marker and IBD data of a loaded pedigree as the interface shows them:
the parent labels the file's caption implies, an individual's genotypes and
IBD summary, every individual's genotype at one marker (for coloring), and a
summary of the file's marker data.

The meaning of the data is in docs/reference/flexqtl-binko-pedimap
(pedimap-input-file-reader-spec.md, sections 4 and 5).
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

from pedigree_engine import PedigreeEngine

# The next most probable founder allele of a homologue is shown above this.
SECOND_ALLELE_THRESHOLD = 0.10

# Caption labels that name the parents' sex; any other pair (PARENT1/PARENT2)
# only numbers them.
_SEXED = {"FEMALE": "Female parent", "MOTHER": "Female parent",
          "MALE": "Male parent", "FATHER": "Male parent"}


def _caption(eng: PedigreeEngine) -> List[str]:
    labels = list((eng.dat_meta or {}).get("parent_columns") or [])
    return labels if len(labels) == 2 else ["FEMALE", "MALE"]


def parent_labels(eng: PedigreeEngine) -> Dict[str, Any]:
    """How the interface names the parents, following the file's caption.

    ``female`` and ``male`` label the engine's female_parent and male_parent
    fields: "Female parent"/"Male parent" for FEMALE/MALE or MOTHER/FATHER,
    "Parent 1"/"Parent 2" for PARENT1/PARENT2 (where female_parent holds the
    first parent column). ``columns`` labels the caption's two parent columns
    in order, which is the order of an individual's two alleles and of its two
    homologues (spec 3.4, 5.5)."""
    caption = [c.upper() for c in _caption(eng)]
    if all(c in _SEXED for c in caption):
        columns = [_SEXED[c] for c in caption]
        return {"female": "Female parent", "male": "Male parent", "columns": columns}
    return {"female": "Parent 1", "male": "Parent 2", "columns": ["Parent 1", "Parent 2"]}


def _unknown(eng: PedigreeEngine) -> set:
    return set((eng.dat_meta or {}).get("unknown") or ["-"])


def _marker_order(eng: PedigreeEngine) -> List[str]:
    """Loci in map order, then any locus that only has genotype rows."""
    order = [m.name for m in eng.markers]
    seen = set(order)
    for ind in eng._individuals.values():
        for mk in ind.markers:
            if mk not in seen:
                seen.add(mk)
                order.append(mk)
    return order


def genotypes(eng: PedigreeEngine, ind_id: str) -> List[Dict[str, Any]]:
    """The individual's genotype rows in map order: the two alleles as written
    (None for unknown) and their indicator codes."""
    ind = eng.get(ind_id)
    unknown = _unknown(eng)
    meta = {m.name: m for m in eng.markers}
    codes = eng.marker_codes.get(ind_id, {})
    rows = []
    for mk in _marker_order(eng):
        alleles = ind.markers.get(mk)
        if alleles is None:
            continue
        m = meta.get(mk)
        rows.append({
            "marker":        mk,
            "linkage_group": m.linkage_group if m else "",
            "position_cM":   m.position_cM if m else None,
            "alleles":       [None if a in unknown else a for a in alleles],
            "codes":         list(codes.get(mk, [])),
        })
    return rows


def _founder_of(eng: PedigreeEngine, allele: int) -> Optional[str]:
    """The founder owning founder allele ``allele`` (1-based), if known: a
    subset Pedimap 2 exported keeps its source's founder alleles, whose
    founders it does not list (dat-format.md §7.4)."""
    order = (eng.dat_meta or {}).get("founder_order")
    if not order:
        return None
    k = (allele - 1) // eng.ploidy
    return order[k] if 0 <= k < len(order) else None


def _likely(eng: PedigreeEngine, vec: List[float]) -> List[Dict[str, Any]]:
    """The most probable founder allele of a homologue, and the next most
    probable when its probability is above SECOND_ALLELE_THRESHOLD."""
    ranked = sorted(range(len(vec)), key=lambda j: (-vec[j], j))
    shown = ranked[:1] + [j for j in ranked[1:2] if vec[j] > SECOND_ALLELE_THRESHOLD]
    return [{"allele": j + 1, "founder": _founder_of(eng, j + 1), "probability": vec[j]}
            for j in shown]


def ibd_summary(eng: PedigreeEngine, ind_id: str) -> List[Dict[str, Any]]:
    """Per IBD position (linkage group by linkage group, in file order), the
    likely founder alleles of each of the individual's homologues."""
    out = []
    for group, by_pos in eng.ibd.items():
        for pos, rows in by_pos.items():
            homologues = rows.get(ind_id)
            if homologues is None:
                continue
            out.append({
                "linkage_group": group,
                "position":      pos,
                "position_cM":   float(pos),
                "homologues":    [_likely(eng, vec) for vec in homologues],
            })
    return out


def marker_values(eng: PedigreeEngine, marker: str) -> Dict[str, Any]:
    """Every individual's genotype at ``marker`` (for coloring by it), and the
    marker's allele names."""
    unknown = _unknown(eng)
    meta = next((m for m in eng.markers if m.name == marker), None)
    values = {}
    names: List[str] = list(meta.allele_names) if meta else []
    for iid, ind in eng._individuals.items():
        alleles = ind.markers.get(marker)
        if alleles is None:
            continue
        shown = [None if a in unknown else a for a in alleles]
        values[iid] = {"alleles": shown,
                       "codes": list(eng.marker_codes.get(iid, {}).get(marker, []))}
        names += [a for a in shown if a is not None and a not in names]
    return {"marker": marker, "allele_names": names, "values": values}


def marker_summary(eng: PedigreeEngine) -> Dict[str, Any]:
    """The file's marker data at a glance: loci and IBD positions per linkage
    group, genotype rows, and the indicator codes in use with their counts (a
    row counts once for each distinct code it has), and whether the codes
    carry FlexQTL's meanings."""
    groups: Dict[str, Dict[str, Any]] = {}
    for m in eng.markers:
        groups.setdefault(m.linkage_group, {"name": m.linkage_group, "loci": 0,
                                            "ibd_positions": 0})["loci"] += 1
    for group, by_pos in eng.ibd.items():
        groups.setdefault(group, {"name": group, "loci": 0, "ibd_positions": 0})
        groups[group]["ibd_positions"] = len(by_pos)
    codes: Counter = Counter()
    rows = 0
    for by_marker in eng.marker_codes.values():
        for row in by_marker.values():
            rows += 1
            codes.update(set(row))
    with_rows = sum(1 for ind in eng._individuals.values() if ind.markers)
    meta = eng.dat_meta or {}
    return {
        "loci":            len(_marker_order(eng)),
        "linkage_groups":  list(groups.values()),
        "ibd_positions":   sum(len(p) for p in eng.ibd.values()),
        "genotype_rows":   rows,
        "individuals_with_genotypes": with_rows,
        "codes":           [{"code": c, "count": n} for c, n in sorted(codes.items(),
                                                                       key=_code_key)],
        "nalleles":        meta.get("nalleles") if eng.ibd else None,
        "founders_named":  bool(meta.get("founder_order")),
        "flexqtl_codes":   flexqtl_codes(eng),
    }


def flexqtl_codes(eng: PedigreeEngine) -> bool:
    """Whether the genotype codes are FlexQTL's consistency classes (spec 4.2):
    FlexQTL and Binko always write a FACTOR0 column, native Pedimap files do
    not, and in those the codes are only colors (dat-format.md §6.1)."""
    return "factor0" in (eng.dat_meta or {})


def _code_key(item: Tuple[Any, int]) -> Tuple[int, Any]:
    code = item[0]
    return (0, code) if isinstance(code, int) else (1, str(code))


def haplotypes(eng: PedigreeEngine, group: str) -> Optional[Dict[str, Any]]:
    """One linkage group's IBD data for the haplotype display, sparse: per
    individual, homologue and position, the nonzero [founder allele,
    probability] pairs (docs/design/haplotype-display.md, §1.2). None when the
    group has no IBD positions."""
    by_pos = eng.ibd.get(group)
    if not by_pos:
        return None
    unknown = _unknown(eng)
    positions = [{"position": pos, "cM": float(pos)} for pos in by_pos]
    markers = []
    founder_alleles: Dict[str, List[Optional[str]]] = {}
    for m in eng.markers:
        if m.linkage_group != group:
            continue
        at = next((p["position"] for p in positions if abs(p["cM"] - m.position_cM) <= 1e-6), None)
        markers.append({"name": m.name, "cM": m.position_cM, "position": at})
        if m.founder_alleles:
            founder_alleles[m.name] = [None if a in unknown else a for a in m.founder_alleles]
    spots = [p["cM"] for p in positions] + [m["cM"] for m in markers]
    meta = eng.dat_meta or {}
    rows: Dict[str, List[List[List[List[float]]]]] = {}
    for iid in eng._individuals:
        homologues: List[List[List[List[float]]]] = [[] for _ in range(eng.ploidy)]
        for pos in by_pos:
            vectors = by_pos[pos].get(iid)
            for h in range(eng.ploidy):
                vec = vectors[h] if vectors else []
                homologues[h].append([[j + 1, v] for j, v in enumerate(vec) if v > 0])
        if any(any(band for band in h) for h in homologues):
            rows[iid] = homologues
    first = next(iter(by_pos.values()))
    nalleles = meta.get("nalleles") or (len(next(iter(first.values()))[0]) if first else 0)
    return {
        "linkage_group":   group,
        "start_cM":        min([0.0] + spots),
        "end_cM":          max(spots),
        "positions":       positions,
        "markers":         markers,
        "nalleles":        nalleles,
        "founders":        meta.get("founder_order") or None,
        "founder_alleles": founder_alleles,
        "rows":            rows,
    }
