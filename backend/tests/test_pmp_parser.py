"""
Tests for pmp_parser against the legacy Pedimap 1.x ground-truth fixtures.

Run: cd backend && python -m pytest tests/ -v
"""
import os

import pytest

from pedigree_engine import PedigreeEngine
from pmp_parser import PmpParser, DatParseError

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def _read(name: str) -> str:
    with open(os.path.join(FIXTURES, name), encoding="utf-8", errors="replace") as fh:
        return fh.read()


@pytest.fixture(scope="module")
def engine():
    return PmpParser.from_pmp_text(_read("Example.pmp"), _read("Example.dat")).engine


# ── Header / pedigree ─────────────────────────────────────────────────────────

def test_population_and_ploidy(engine):
    assert engine.population_name == "Apples"
    assert engine.ploidy == 2
    assert engine.count() == 8


def test_founders_have_no_parents(engine):
    for fid in ("GoldenD", "IngridM", "Jonathan", "Cox"):
        ind = engine.get(fid)
        assert ind.female_parent is None and ind.male_parent is None
        assert ind.cross_type.value == "unknown"


def test_cross_parents_female_first(engine):
    elstar = engine.get("Elstar")
    assert elstar.female_parent == "GoldenD"
    assert elstar.male_parent == "IngridM"
    assert elstar.cross_type.value == "cross"


def test_child_listed_before_parents_still_links(engine):
    # 81015-045 is the first pedigree row but its parents appear later.
    kid = engine.get("81015-045")
    assert kid.female_parent == "Elstar"
    assert kid.male_parent == "Elise"
    # generation is assigned lazily by the engine's topological pass
    engine.assign_generations()
    assert kid.generation > engine.get("Elstar").generation


# ── Trait inference ───────────────────────────────────────────────────────────

def test_color_is_qualitative(engine):
    color = next(t for t in engine.traits if t.name == "Color")
    assert color.trait_type.value == "qualitative"
    assert set(color.categories) == {"Green", "Red", "Yellow"}


def test_length_is_continuous(engine):
    length = next(t for t in engine.traits if t.name == "Length")
    assert length.trait_type.value == "continuous"
    assert length.min_val == pytest.approx(11.4)
    assert length.max_val == pytest.approx(23.9)


# ── Markers ───────────────────────────────────────────────────────────────────

def test_marker_metadata(engine):
    ssr1 = next(m for m in engine.markers if m.name == "SSR1")
    assert ssr1.linkage_group == "A"
    assert ssr1.position_cM == 0.0
    assert ssr1.allele_names == ["180", "182", "188", "194", "202"]
    assert len(ssr1.founder_alleles) == 8


def test_observed_genotypes(engine):
    # Elstar SSR1: homozygous / null -> alleles 180 and $
    assert engine.get("Elstar").markers["SSR1"] == ["180", "$"]
    # Missing data preserved as the raw token
    assert engine.get("Elise").markers["SSR2"] == ["-", "-"]


# ── IBD ───────────────────────────────────────────────────────────────────────

def test_ibd_linkage_groups_and_positions(engine):
    assert set(engine.ibd.keys()) == {"A", "B", "C"}
    assert set(engine.ibd["A"].keys()) == {"0", "20", "29"}
    # The '/' delimiter typo ("IBDPOSITION 0 / LG C") must still parse.
    assert set(engine.ibd["C"].keys()) == {"0"}


def test_ibd_every_individual_present(engine):
    ids = set(engine.all_ids())
    for lg, positions in engine.ibd.items():
        for pos, rows in positions.items():
            assert set(rows.keys()) == ids, f"LG {lg} pos {pos} incomplete"


def test_ibd_homologues_sum_to_one(engine):
    for lg, positions in engine.ibd.items():
        for pos, rows in positions.items():
            for ind, homologues in rows.items():
                for vec in homologues:
                    assert abs(sum(vec) - 1.0) <= 0.05


def test_ibd_survives_dict_round_trip(engine):
    # to_dict() emits "ibd"; from_dict() must read it back (regression: it was
    # silently discarded, losing IBD data through /api/load JSON round-trips).
    data = engine.to_dict()
    reimported = PedigreeEngine.from_dict(data)

    # Same 3 linkage groups and 5 total positions (A:0,20,29 ; B:0 ; C:0).
    assert set(reimported.ibd.keys()) == {"A", "B", "C"}
    assert sum(len(p) for p in reimported.ibd.values()) == 5

    # Every probability, exactly, at every (lg, position, individual, homologue).
    assert reimported.ibd == engine.ibd
    for lg in engine.ibd:
        for pos in engine.ibd[lg]:
            for ind in engine.ibd[lg][pos]:
                assert reimported.ibd[lg][pos][ind] == engine.ibd[lg][pos][ind]

    # A non-IBD payload must round-trip to an empty dict, not raise.
    assert PedigreeEngine.from_dict({"population": "x"}).ibd == {}


# ── Spec confirmations ────────────────────────────────────────────────────────

def test_single_character_numeric_trait_is_discrete():
    # Trait-type rule: all-single-character values are DISCRETE even if numeric.
    dat = (
        "PEDIGREE\n"
        "NAME FEMALE MALE Score Size\n"
        "A - - 1 10\n"
        "B - - 9 50\n"
        "C - - 5 25\n"
    )
    eng = PmpParser.from_dat_text(dat).engine
    score = next(t for t in eng.traits if t.name == "Score")
    size = next(t for t in eng.traits if t.name == "Size")

    # 1, 9, 5 → all single characters → discrete (qualitative), despite numeric.
    assert score.trait_type.value == "qualitative"
    assert set(score.categories) == {"1", "9", "5"}
    # 10, 50, 25 → multi-character numbers → continuous.
    assert size.trait_type.value == "continuous"
    assert size.min_val == 10.0 and size.max_val == 50.0


def test_decimal_trait_is_continuous():
    # 2.5 .. 7.4 → multi-character numbers → continuous (contrast to 1-9).
    dat = (
        "PEDIGREE\nNAME FEMALE MALE Score\n"
        "A - - 2.5\nB - - 7.4\nC - - 5.0\n"
    )
    eng = PmpParser.from_dat_text(dat).engine
    score = next(t for t in eng.traits if t.name == "Score")
    assert score.trait_type.value == "continuous"


def test_topological_order_child_after_both_parents(engine):
    # Example.dat lists "81015-045" as the FIRST pedigree row, but its parents
    # Elstar and Elise appear later. The sorted order must place it after both.
    order = list(engine.to_dict()["individuals"].keys())
    assert order.index("81015-045") > order.index("Elstar")
    assert order.index("81015-045") > order.index("Elise")


# ── Error handling ────────────────────────────────────────────────────────────

def test_cycle_detection_names_members():
    cyc = "PEDIGREE\nNAME FEMALE MALE\nA B -\nB A -\n"
    with pytest.raises(DatParseError) as exc:
        PmpParser.from_dat_text(cyc)
    assert "A" in str(exc.value) and "B" in str(exc.value)


def test_reversed_parent_order_detected():
    rev = "PEDIGREE\nNAME MALE FEMALE\nKid Sire Dam\nSire - -\nDam - -\n"
    eng = PmpParser.from_dat_text(rev).engine
    kid = eng.get("Kid")
    assert kid.female_parent == "Dam" and kid.male_parent == "Sire"


def test_ibd_bad_sum_rejected():
    bad = ("NALLELES = 2\nPEDIGREE\nNAME FEMALE MALE\nX - -\n"
           "IBDPOSITION 0 ; LG A\nX 0.3 0.3 1.0 0.0\n")
    with pytest.raises(DatParseError):
        PmpParser.from_dat_text(bad)


def test_pedigree_only_subset_parses():
    minimal = "PEDIGREE\nNAME FEMALE MALE\nA - -\nB A -\n"
    eng = PmpParser.from_dat_text(minimal).engine
    assert eng.count() == 2
    assert eng.ibd == {}
