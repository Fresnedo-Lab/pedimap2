"""
The marker and IBD data the interface shows: parent labels from the caption,
an individual's genotypes and IBD summary, genotypes at a marker for coloring,
and the summary of a file's marker data.

Run: cd backend && python -m pytest tests/test_marker_panels.py -v
"""
import os

import pytest

import api
import marker_data
from pmp_parser import PmpParser
from tests.reader_spec import read_fixture

EXAMPLE = os.path.join(os.path.dirname(__file__), "fixtures", "Example.dat")


def _engine(name: str):
    if name == "Example.dat":
        with open(EXAMPLE, encoding="utf-8") as fh:
            return PmpParser.from_dat_text(fh.read()).engine
    return PmpParser.from_dat_text(read_fixture(name)).engine


@pytest.fixture
def loaded(monkeypatch):
    """Make a file the API's active pedigree."""
    def load(name: str):
        monkeypatch.setattr(api, "_engine", _engine(name))
        return api._engine
    return load


# ── Parent labels ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("caption, labels", [
    ("FEMALE MALE",     ("Female parent", "Male parent", ["Female parent", "Male parent"])),
    ("MOTHER FATHER",   ("Female parent", "Male parent", ["Female parent", "Male parent"])),
    ("MALE FEMALE",     ("Female parent", "Male parent", ["Male parent", "Female parent"])),
    ("PARENT1 PARENT2", ("Parent 1", "Parent 2", ["Parent 1", "Parent 2"])),
])
def test_parent_labels_follow_the_caption(caption, labels):
    eng = PmpParser.from_dat_text(f"PEDIGREE\nNAME {caption}\nA - -\n").engine
    got = marker_data.parent_labels(eng)
    assert (got["female"], got["male"], got["columns"]) == labels


def test_parent_labels_of_the_fixtures(loaded):
    loaded("Example.dat")
    assert api.get_pedigree()["parent_labels"]["female"] == "Female parent"
    for name in ("binko_legacy.ped", "binko_ibd.ped", "flexqtl_routeB_sim_small.ped"):
        loaded(name)
        assert api.get_pedigree()["parent_labels"] == {
            "female": "Parent 1", "male": "Parent 2", "columns": ["Parent 1", "Parent 2"]}


PARENTS_1_2 = {"female": "Parent 1", "male": "Parent 2", "columns": ["Parent 1", "Parent 2"]}


def test_data_without_parent_columns_has_parent_1_and_2(monkeypatch):
    """The demo data and JSON without recorded columns do not state sex."""
    from sample_data import load_sample_data
    from pedigree_engine import PedigreeEngine
    demo = load_sample_data()
    assert marker_data.parent_labels(demo) == PARENTS_1_2
    plain = PedigreeEngine.from_dict({"population": "P", "individuals": {
        "A": {"name": "A"}, "B": {"name": "B"}, "C": {"name": "C", "female_parent": "A", "male_parent": "B"}}})
    assert marker_data.parent_labels(plain) == PARENTS_1_2


def test_dat_export_of_such_data_reads_back_as_parent_1_and_2():
    """Its .dat export writes PARENT1 PARENT2, so reading it back keeps the
    labels, and the parents stay in their places."""
    from sample_data import load_sample_data
    from pmp_parser import DatExporter
    demo = load_sample_data()
    text = DatExporter.to_dat_text(demo)
    caption = text.split("PEDIGREE", 1)[1].strip().splitlines()[0].split()
    assert caption[:3] == ["NAME", "PARENT1", "PARENT2"]
    back = PmpParser.from_dat_text(text).engine
    assert marker_data.parent_labels(back) == PARENTS_1_2
    # A .dat file names individuals by name; each keeps its parents in place.
    name = {iid: demo.get(iid).name for iid in demo._individuals}
    for iid in demo._individuals:
        a, b = demo.get(iid), back.get(name[iid])
        assert (name.get(a.female_parent), name.get(a.male_parent)) == (b.female_parent, b.male_parent), iid


def test_json_keeps_recorded_parent_columns(loaded):
    """A JSON file saved from a FEMALE/MALE file keeps its columns."""
    from pedigree_engine import PedigreeEngine
    eng = loaded("Example.dat")
    again = PedigreeEngine.from_dict(eng.to_dict())
    assert marker_data.parent_labels(again)["female"] == "Female parent"


# ── Genotypes ─────────────────────────────────────────────────────────────────

def test_genotypes_in_map_order_with_codes(loaded):
    loaded("binko_legacy.ped")
    rows = api.get_individual("G1_001")["genotypes"]
    assert [r["marker"] for r in rows][:5] == ["M1_001", "M1_002", "M1_003", "M1_004", "M2_001"]
    assert [r["linkage_group"] for r in rows] == ["1"] * 4 + ["2"] * 4 + ["3"] * 3
    # "G1_001  G 1  A 1" at M1_001 (spec 4.2): filled in; the alleles as written.
    assert rows[0] == {"marker": "M1_001", "linkage_group": "1", "position_cM": 0.0,
                       "alleles": ["G", "A"], "codes": [1, 1]}


def test_unknown_alleles_and_individuals_without_rows(loaded):
    loaded("binko_legacy.ped")
    f003 = {r["marker"]: r for r in api.get_individual("F003")["genotypes"]}
    assert f003["M1_001"]["alleles"] == [None, None] and f003["M1_001"]["codes"] == [5, 5]
    assert api.get_individual("DUMMY_G1_007_F")["genotypes"] == []     # no genotype data


def test_example_genotypes_keep_the_null_symbol(loaded):
    loaded("Example.dat")
    elstar = api.get_individual("Elstar")["genotypes"][0]
    assert elstar["alleles"] == ["180", "$"] and elstar["codes"] == [2, 2]
    assert api.get_individual("Elise")["genotypes"][1]["alleles"] == [None, None]


# ── IBD ───────────────────────────────────────────────────────────────────────

def test_ibd_most_probable_founder_alleles(loaded):
    loaded("flexqtl_routeB_sim_small.ped")
    first = api.get_individual("G1_001")["ibd"][0]
    assert (first["linkage_group"], first["position"]) == ("1", "0.000")
    # Spec 5.5: G1_001 has [23] 0.95 [24] 0.05 from F003 (founder 12), and
    # [38] 1.0 from F010 (founder 19). 0.05 is not above 0.10, so not shown.
    assert first["homologues"] == [
        [{"allele": 23, "founder": "F003", "founder_name": "F003", "probability": 0.95}],
        [{"allele": 38, "founder": "F010", "founder_name": "F010", "probability": 1.0}],
    ]


def test_ibd_shows_the_next_allele_above_a_tenth(loaded):
    loaded("flexqtl_routeB_sim_small.ped")
    h1, h2 = api.get_individual("G1_007")["ibd"][0]["homologues"]
    # A founder without data splits its offspring's homologue evenly (spec 5.9).
    dummy = {"founder": "DUMMY_G1_007_M", "founder_name": "DUMMY_G1_007_M", "probability": 0.5}
    assert h1 == [{"allele": 1, **dummy}, {"allele": 2, **dummy}]
    assert [a["allele"] for a in h2] == [45]
    loaded("Example.dat")
    h1, h2 = api.get_individual("81015-045")["ibd"][1]["homologues"]
    assert [(a["founder"], a["probability"]) for a in h1] == [("IngridM", 0.77), ("IngridM", 0.15)]
    assert [(a["founder"], a["probability"]) for a in h2] == [("Cox", 0.58), ("Jonathan", 0.26)]


def test_flexqtl_groups_show_their_own_positions(loaded):
    # Guards #18: both linkage groups have position 0.000; each keeps its own
    # 21 positions and its own probabilities.
    loaded("flexqtl_routeB_sim_small.ped")
    summary = api.get_pedigree()["marker_summary"]
    assert [(g["name"], g["loci"], g["ibd_positions"]) for g in summary["linkage_groups"]] == [
        ("1", 21, 21), ("2", 21, 21)]
    ibd = api.get_individual("G1_001")["ibd"]
    by_group = {g: [p["position"] for p in ibd if p["linkage_group"] == g] for g in ("1", "2")}
    assert len(by_group["1"]) == len(by_group["2"]) == 21
    assert by_group["1"][0] == by_group["2"][0] == "0.000"
    at_zero = [p["homologues"] for p in ibd if p["position"] == "0.000"]
    assert at_zero[0] != at_zero[1]


def test_supplied_founder_rows_and_unnamed_founders(loaded):
    eng = loaded("binko_ibd.ped")
    h1, h2 = api.get_individual("DUMMY_G1_007_F")["ibd"][0]["homologues"]
    own = {"founder": "DUMMY_G1_007_F", "founder_name": "DUMMY_G1_007_F", "probability": 1.0}
    assert h1 == [{"allele": 13, **own}]
    assert h2 == [{"allele": 14, **own}]
    del eng.dat_meta["founder_order"]          # as in an exported subset
    assert api.get_individual("G1_001")["ibd"][0]["homologues"][0][0]["founder"] is None


# ── Coloring by a marker ──────────────────────────────────────────────────────

def test_marker_values(loaded):
    loaded("binko_legacy.ped")
    values = api.get_marker_values("M1_001")
    assert values["allele_names"] == ["A", "G"]
    assert values["values"]["G1_001"] == {"alleles": ["G", "A"], "codes": [1, 1]}
    assert values["values"]["F003"] == {"alleles": [None, None], "codes": [5, 5]}
    assert "DUMMY_G1_007_F" not in values["values"]
    with pytest.raises(api.HTTPException):
        api.get_marker_values("M9_999")


# ── Summary ───────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("name, loci, groups, positions, codes", [
    # Codes as counted in the spec's table (4.2).
    ("binko_legacy.ped", 11, 3, 0, {0: 231, 1: 9, 2: 1, 5: 19, 7: 4}),
    ("binko_ibd.ped", 11, 3, 3, {0: 236, 1: 28}),
    ("flexqtl_routeB_sim_small.ped", 42, 2, 42, {0: 2717, 5: 378, 11: 13}),
    ("Example.dat", 5, 3, 5, {0: 32, 1: 1, 2: 7}),
])
def test_marker_summary(loaded, name, loci, groups, positions, codes):
    loaded(name)
    s = api.get_pedigree()["marker_summary"]
    assert (s["loci"], len(s["linkage_groups"]), s["ibd_positions"]) == (loci, groups, positions)
    assert {c["code"]: c["count"] for c in s["codes"]} == codes
    assert s["founders_named"] == (positions > 0)
    # FlexQTL's meanings apply to FlexQTL and Binko files (FACTOR0), not Example.dat.
    assert s["flexqtl_codes"] == (name != "Example.dat")


def test_summary_without_marker_data(loaded):
    loaded("Example.dat")
    api._engine = PmpParser.from_dat_text("PEDIGREE\nNAME FEMALE MALE\nA - -\n").engine
    s = api.get_pedigree()["marker_summary"]
    assert (s["loci"], s["linkage_groups"], s["codes"], s["nalleles"]) == (0, [], [], None)
    assert api.get_individual("A")["genotypes"] == [] and api.get_individual("A")["ibd"] == []
