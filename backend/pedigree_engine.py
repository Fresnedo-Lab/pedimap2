"""
pedigree_engine.py  –  Pedimap 2.0
====================================
Core pedigree engine built on NetworkX.
All graph queries, trait colouring and layout logic live here.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Any, Dict, List, Optional, Tuple

import networkx as nx


# ── Enumerations ──────────────────────────────────────────────────────────────

class CrossType(str, Enum):
    CROSS            = "cross"
    SELF             = "self"
    CLONE            = "clone"
    DOUBLED_HAPLOID  = "dh"
    BACKCROSS        = "backcross"
    OPEN_POLLINATED  = "op"
    MUTANT           = "mut"
    UNKNOWN          = "unknown"


class TraitType(str, Enum):
    CONTINUOUS   = "continuous"
    QUALITATIVE  = "qualitative"


# ── Dataclasses ───────────────────────────────────────────────────────────────

@dataclass
class TraitMeta:
    name: str
    trait_type: TraitType = TraitType.CONTINUOUS
    min_val: float = 0.0
    max_val: float = 1.0
    categories: List[str] = field(default_factory=list)
    color_low:  str = "#3B82F6"
    color_high: str = "#EF4444"
    # Per-value color overrides for discrete traits: {category: "#rrggbb"}.
    # Takes precedence over semantic color-name resolution and the palette,
    # so a user can reassign any value's color (as Pedimap 1.x allowed).
    value_colors: Dict[str, str] = field(default_factory=dict)


@dataclass
class MarkerMeta:
    name: str
    linkage_group: str = ""
    position_cM:  float = 0.0
    allele_names: List[str] = field(default_factory=list)
    founder_alleles: List[str] = field(default_factory=list)


@dataclass
class Individual:
    id: str
    name: str
    female_parent: Optional[str] = None
    male_parent:   Optional[str] = None
    cross_type:    CrossType     = CrossType.CROSS
    ploidy:        int           = 2
    generation:    int           = 0
    traits:  Dict[str, Any]      = field(default_factory=dict)
    markers: Dict[str, List[str]] = field(default_factory=dict)
    notes:   str                 = ""


# ── Engine ────────────────────────────────────────────────────────────────────

class PedigreeEngine:
    """
    Directed Acyclic Graph where edges point  parent → offspring.
    Node payload is an Individual dataclass; edge payload carries
    whether the parent is the female (mother) or male (father).
    """

    def __init__(self) -> None:
        self.graph: nx.DiGraph = nx.DiGraph()
        self._individuals: Dict[str, Individual] = {}
        self.traits:  List[TraitMeta]  = []
        self.markers: List[MarkerMeta] = []
        self.population_name: str = ""
        self.ploidy: int = 2
        # IBD founder-allele probabilities keyed lg -> position -> individual ->
        # [homologue vectors]. Populated by the .dat parser; empty otherwise.
        # No UI consumes it yet, but it is carried through to_dict() so the data
        # survives a round-trip.
        self.ibd: Dict[str, Any] = {}
        # Observed-allele color codes keyed individual -> marker -> [codes],
        # parallel to Individual.markers (which holds the allele names).
        self.marker_codes: Dict[str, Dict[str, List[str]]] = {}
        # Details of the source .dat file that the engine model doesn't otherwise
        # hold — header values (unknown, nullhomoz, nalleles), the parent-column
        # labels, the original row order and the IBDPOSITIONS lists — so that
        # DatExporter can write the file back faithfully. Empty for other sources.
        self.dat_meta: Dict[str, Any] = {}

    # ── Mutation ──────────────────────────────────────────────────────────────

    def add_individual(self, ind: Individual) -> None:
        if ind.id in self._individuals:
            raise ValueError(f"Individual '{ind.id}' already exists.")
        self._individuals[ind.id] = ind
        self.graph.add_node(ind.id, data=ind)
        if ind.female_parent and ind.female_parent in self._individuals:
            self.graph.add_edge(ind.female_parent, ind.id, role="female")
        if ind.male_parent and ind.male_parent in self._individuals:
            self.graph.add_edge(ind.male_parent,   ind.id, role="male")

    def remove_individual(self, ind_id: str) -> None:
        self.graph.remove_node(ind_id)
        del self._individuals[ind_id]
        self.marker_codes.pop(ind_id, None)

    # ── Accessors ─────────────────────────────────────────────────────────────

    def get(self, ind_id: str) -> Optional[Individual]:
        return self._individuals.get(ind_id)

    def all_ids(self) -> List[str]:
        return list(self._individuals.keys())

    def in_order(self, ids) -> List[str]:
        """Return the given ids sorted by the engine's (topological) order."""
        rank = {iid: k for k, iid in enumerate(self._individuals)}
        return sorted((i for i in ids if i in rank), key=rank.__getitem__)

    def count(self) -> int:
        return len(self._individuals)

    # ── Graph queries ─────────────────────────────────────────────────────────

    def ancestors(self, ind_id: str) -> List[str]:
        return list(nx.ancestors(self.graph, ind_id))

    def descendants(self, ind_id: str) -> List[str]:
        return list(nx.descendants(self.graph, ind_id))

    def siblings(self, ind_id: str) -> List[str]:
        sibs: set = set()
        ind = self.get(ind_id)
        if not ind:
            return []
        for parent_id in [ind.female_parent, ind.male_parent]:
            if parent_id:
                for child in self.graph.successors(parent_id):
                    if child != ind_id:
                        sibs.add(child)
        return list(sibs)

    def founders(self) -> List[str]:
        return [n for n, d in self.graph.in_degree() if d == 0]

    def leaves(self) -> List[str]:
        return [n for n, d in self.graph.out_degree() if d == 0]

    def generation_of(self, ind_id: str) -> int:
        ind = self.get(ind_id)
        return ind.generation if ind else 0

    # ── Layout ────────────────────────────────────────────────────────────────

    def assign_generations(self) -> None:
        """Longest-path generation assignment (founders = gen 0)."""
        gen: Dict[str, int] = {}
        for node in nx.topological_sort(self.graph):
            parents = list(self.graph.predecessors(node))
            gen[node] = max((gen[p] + 1 for p in parents), default=0)
        for ind_id, g in gen.items():
            ind = self._individuals.get(ind_id)
            if ind:
                ind.generation = g

    def layout(self) -> Dict[str, Dict[str, float]]:
        """
        Returns {id: {x, y}} positions for the canvas.
        Uses a generation-based layout: y = generation * spacing,
        x = evenly distributed within each generation.
        """
        self.assign_generations()
        by_gen: Dict[int, List[str]] = {}
        for ind_id, ind in self._individuals.items():
            by_gen.setdefault(ind.generation, []).append(ind_id)

        positions: Dict[str, Dict[str, float]] = {}
        spacing_y = 160
        spacing_x = 140

        for gen_idx, members in by_gen.items():
            members.sort()
            total_width = (len(members) - 1) * spacing_x
            for i, ind_id in enumerate(members):
                positions[ind_id] = {
                    "x": i * spacing_x - total_width / 2,
                    "y": gen_idx * spacing_y,
                }
        return positions

    # ── Serialisation ─────────────────────────────────────────────────────────

    def to_dict(self) -> dict:
        self.assign_generations()
        return {
            "population": self.population_name,
            "ploidy": self.ploidy,
            "individual_count": self.count(),
            "individuals": {
                iid: {
                    "id":            ind.id,
                    "name":          ind.name,
                    "female_parent": ind.female_parent,
                    "male_parent":   ind.male_parent,
                    "cross_type":    ind.cross_type.value,
                    "ploidy":        ind.ploidy,
                    "generation":    ind.generation,
                    "traits":        ind.traits,
                    "markers":       ind.markers,
                    "notes":         ind.notes,
                }
                for iid, ind in self._individuals.items()
            },
            "traits":  [
                {
                    "name":       t.name,
                    "type":       t.trait_type.value,
                    "min":        t.min_val,
                    "max":        t.max_val,
                    "categories": t.categories,
                    "color_low":  t.color_low,
                    "color_high": t.color_high,
                    "value_colors": t.value_colors,
                }
                for t in self.traits
            ],
            "markers": [
                {
                    "name":            m.name,
                    "linkage_group":   m.linkage_group,
                    "position_cM":     m.position_cM,
                    "allele_names":    m.allele_names,
                    "founder_alleles": m.founder_alleles,
                }
                for m in self.markers
            ],
            "ibd": self.ibd,
            "marker_codes": self.marker_codes,
            "dat_meta": self.dat_meta,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "PedigreeEngine":
        eng = cls()
        eng.population_name = data.get("population", "")
        eng.ploidy = data.get("ploidy", 2)
        # Round-trip IBD data (emitted by to_dict); absent for non-IBD files.
        eng.ibd = data.get("ibd", {})
        eng.marker_codes = data.get("marker_codes", {})
        eng.dat_meta = data.get("dat_meta", {})
        for t in data.get("traits", []):
            eng.traits.append(TraitMeta(
                name=t["name"],
                trait_type=TraitType(t.get("type", "continuous")),
                min_val=t.get("min", 0.0),
                max_val=t.get("max", 1.0),
                categories=t.get("categories", []),
                color_low=t.get("color_low", "#3B82F6"),
                color_high=t.get("color_high", "#EF4444"),
                value_colors=t.get("value_colors", {}),
            ))
        for m in data.get("markers", []):
            eng.markers.append(MarkerMeta(
                name=m["name"],
                linkage_group=m.get("linkage_group", ""),
                position_cM=m.get("position_cM", 0.0),
                allele_names=m.get("allele_names", []),
                founder_alleles=m.get("founder_alleles", []),
            ))
        for iid, idata in data.get("individuals", {}).items():
            ind = Individual(
                id=iid,
                name=idata.get("name", iid),
                female_parent=idata.get("female_parent"),
                male_parent=idata.get("male_parent"),
                cross_type=CrossType(idata.get("cross_type", "cross")),
                ploidy=idata.get("ploidy", 2),
                generation=idata.get("generation", 0),
                traits=idata.get("traits", {}),
                markers=idata.get("markers", {}),
                notes=idata.get("notes", ""),
            )
            eng._individuals[iid] = ind
            eng.graph.add_node(iid, data=ind)
        for iid, ind in eng._individuals.items():
            if ind.female_parent and ind.female_parent in eng._individuals:
                eng.graph.add_edge(ind.female_parent, iid, role="female")
            if ind.male_parent and ind.male_parent in eng._individuals:
                eng.graph.add_edge(ind.male_parent,   iid, role="male")
        return eng

    # ── Colour helpers ────────────────────────────────────────────────────────

    def trait_color(self, ind_id: str, trait_name: str) -> str:
        ind = self.get(ind_id)
        if not ind:
            return "#6B7280"
        val = ind.traits.get(trait_name)
        if val is None:
            return "#6B7280"
        meta = next((t for t in self.traits if t.name == trait_name), None)
        if not meta:
            return "#6B7280"
        if meta.trait_type == TraitType.QUALITATIVE:
            return _discrete_color_map(meta).get(str(val), "#6B7280")
        try:
            fval = float(val)
            rng = meta.max_val - meta.min_val
            if rng == 0:
                return meta.color_low
            t = max(0.0, min(1.0, (fval - meta.min_val) / rng))
            return _lerp_hex(meta.color_low, meta.color_high, t)
        except (TypeError, ValueError):
            return "#6B7280"


# ── Discrete-trait coloring ───────────────────────────────────────────────────

# Known color names -> a representative hex. When a discrete trait value
# case-insensitively matches one of these, it is drawn in that color (so a
# "Red" value is red, not whatever the palette happened to assign by position).
_COLOR_NAMES: Dict[str, str] = {
    "red":    "#EF4444",
    "green":  "#22C55E",
    "yellow": "#EAB308",
    "blue":   "#3B82F6",
    "orange": "#F97316",
    "purple": "#A855F7",
    "pink":   "#EC4899",
    "brown":  "#92400E",
    "white":  "#F8FAFC",
    "black":  "#111827",
    "grey":   "#6B7280",
    "gray":   "#6B7280",
}

# Fallback categorical palette for values that are not color names.
_QUAL_PALETTE: List[str] = [
    "#3B82F6", "#10B981", "#F59E0B", "#EF4444",
    "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16",
]


def _discrete_color_map(meta: "TraitMeta") -> Dict[str, str]:
    """Resolve every category of a discrete trait to a color.

    Precedence, per value:
      1. explicit user override (meta.value_colors)
      2. semantic color-name match (case-insensitive)
      3. categorical palette, skipping any color already used above so a
         non-color value never collides with a resolved one.
    """
    result: Dict[str, str] = {}
    used: set = set()

    overrides = meta.value_colors or {}
    for cat in meta.categories:
        if cat in overrides:
            result[cat] = overrides[cat]
            used.add(overrides[cat].lower())

    for cat in meta.categories:
        if cat in result:
            continue
        hexv = _COLOR_NAMES.get(str(cat).strip().lower())
        if hexv:
            result[cat] = hexv
            used.add(hexv.lower())

    pi = 0
    for cat in meta.categories:
        if cat in result:
            continue
        while pi < len(_QUAL_PALETTE) and _QUAL_PALETTE[pi].lower() in used:
            pi += 1
        if pi < len(_QUAL_PALETTE):
            result[cat] = _QUAL_PALETTE[pi]
            used.add(_QUAL_PALETTE[pi].lower())
            pi += 1
        else:
            result[cat] = "#6B7280"
    return result


def _lerp_hex(c1: str, c2: str, t: float) -> str:
    def parse(c: str):
        c = c.lstrip("#")
        return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
    r1, g1, b1 = parse(c1)
    r2, g2, b2 = parse(c2)
    r = int(r1 + (r2 - r1) * t)
    g = int(g1 + (g2 - g1) * t)
    b = int(b1 + (b2 - b1) * t)
    return f"#{r:02x}{g:02x}{b:02x}"
