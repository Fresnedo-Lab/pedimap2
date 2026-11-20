"""
/api/haplotypes: one linkage group's IBD probabilities for the haplotype
display, sparse; and /api/pedigree without them
(docs/design/haplotype-display.md, §1.2, §8).

Run: cd backend && python -m pytest tests/test_haplotypes.py -v
"""
import json

import pytest

import api
from pmp_parser import DatExporter, PmpParser
from tests.reader_spec import read_fixture
from tests.synthetic_ibd import synthetic_ibd_dat


@pytest.fixture
def load(monkeypatch):
    def _load(text: str):
        monkeypatch.setattr(api, "_engine", PmpParser.from_dat_text(text).engine)
        return api._engine
    return _load


def test_flexqtl_group_is_sparse_and_small(load):
    eng = load(read_fixture("flexqtl_routeB_sim_small.ped"))
    data = api.get_haplotypes("1")
    assert (data["start_cM"], data["end_cM"], data["nalleles"]) == (0.0, 100.0, 58)
    assert len(data["positions"]) == 21 and len(data["rows"]) == 74
    assert data["founders"] == eng.dat_meta["founder_order"]
    # G1_001 at 0.000 (spec 5.5): [23] 0.95, [24] 0.05 | [38] 1.0
    assert data["rows"]["G1_001"][0][0] == [[23, 0.95], [24, 0.05]]
    assert data["rows"]["G1_001"][1][0] == [[38, 1.0]]
    # Every nonzero value is there, and nothing else.
    for iid, homologues in data["rows"].items():
        for h, bands in enumerate(homologues):
            for k, pos in enumerate(eng.ibd["1"]):
                vec = eng.ibd["1"][pos][iid][h]
                assert bands[k] == [[j + 1, v] for j, v in enumerate(vec) if v > 0]
    assert len(json.dumps(data)) <= 100_000                    # budget (design §8)


def test_each_flexqtl_group_has_its_own_positions(load):
    load(read_fixture("flexqtl_routeB_sim_small.ped"))
    g1, g2 = api.get_haplotypes("1"), api.get_haplotypes("2")
    assert g1["positions"][0]["position"] == g2["positions"][0]["position"] == "0.000"
    assert g1["rows"]["G1_001"] != g2["rows"]["G1_001"]


def test_binko_position_between_markers_and_dummy_founders(load):
    load(read_fixture("binko_ibd.ped"))
    data = api.get_haplotypes("1")
    assert [p["cM"] for p in data["positions"]] == [5.0, 20.0]
    assert [m["position"] for m in data["markers"]] == [None, None, "20.0000", None]
    k = data["founders"].index("DUMMY_G1_007_F")
    assert data["rows"]["DUMMY_G1_007_F"] == [[[[2 * k + 1, 1.0]]] * 2, [[[2 * k + 2, 1.0]]] * 2]
    assert data["founder_alleles"]["M1_003"][2 * k] is not None   # Binko fills them in
    with pytest.raises(api.HTTPException) as exc:                # group 2: no positions
        api.get_haplotypes("2")
    assert exc.value.status_code == 404


def test_subset_without_founder_names(load):
    source = PmpParser.from_dat_text(read_fixture("binko_ibd.ped")).engine
    load(DatExporter.to_dat_text(source, ids=["G2_001", "G2_004"]))
    data = api.get_haplotypes("1")
    assert data["founders"] is None and data["nalleles"] == 16


def test_pedigree_leaves_out_ibd(load):
    load(read_fixture("flexqtl_routeB_sim_small.ped"))
    pedigree = api.get_pedigree()
    assert "ibd" not in pedigree
    assert len(json.dumps(pedigree)) < 300_000                  # was 2.07 MB
    assert api.export_json().body                                # the JSON export keeps it
    assert "ibd" in json.loads(api.export_json().body)


def test_synthetic_pedigree_for_performance(load):
    load(synthetic_ibd_dat())
    eng = api._engine
    eng.assign_generations()
    assert eng.count() == 300 and len(eng.dat_meta["founder_order"]) == 30
    assert max(i.generation for i in eng._individuals.values()) == 6
    data = api.get_haplotypes("1")
    assert len(data["positions"]) == 50
    assert len(json.dumps(data)) <= 1_000_000                  # budget (design §8)
