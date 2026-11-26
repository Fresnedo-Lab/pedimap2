"""
The interface names individuals by name, never by id. In the demo data (and
in JSON files) the ids differ from the names: G1_03 is WA-103. The ids stay
the key; the payloads carry the names to show next to them.

Run: cd backend && python -m pytest tests/test_display_names.py -v
"""
import pytest

import api
from pmp_parser import DatExporter, PmpParser
from sample_data import load_sample_data
from tests.reader_spec import read_fixture


@pytest.fixture
def demo(monkeypatch):
    eng = load_sample_data()
    monkeypatch.setattr(api, "_engine", eng)
    return eng


def test_the_demo_ids_differ_from_the_names(demo):
    assert demo.get("G1_03").name == "WA-103"


def test_details_name_the_parents(demo):
    sel204 = api.get_individual("G2_04")
    assert (sel204["female_parent"], sel204["male_parent"]) == ("G1_03", "G1_04")
    assert (sel204["female_parent_name"], sel204["male_parent_name"]) == ("WA-103", "WA-104")
    founder = api.get_individual("F01")
    assert (founder["female_parent_name"], founder["male_parent_name"]) == (None, None)


def test_graph_and_subpopulation_nodes_name_the_parents(demo):
    node = next(n for n in api.get_graph()["nodes"] if n["id"] == "G2_04")
    assert (node["label"], node["female_parent_name"], node["male_parent_name"]) == (
        "SEL-204", "WA-103", "WA-104")
    sub = api.build_subpop(api.SubpopRequest(focal_id="G2_04", ancestors=False,
                                             descendants=True, siblings=False))
    focal = next(n for n in sub["nodes"] if n["is_focal"])
    # The parents are outside the subpopulation; the tooltip still names them.
    assert (focal["female_parent_name"], focal["male_parent_name"]) == ("WA-103", "WA-104")


def test_subpopulation_dat_names_its_focal_individual(demo):
    ids = ["G1_02", *demo.in_order(demo.descendants("G1_02"))]
    req = api.DatExportRequest(ids=ids, focal_id="G1_02", descendants=True)
    text = api.export_dat_subset(req).body.decode()
    assert "; Focal individual: WA-102" in text.splitlines()
    assert "G1_02" not in text                       # the file names, not ids


def test_the_focal_comment_matches_the_file_when_names_repeat(demo):
    # Names that are not unique are written as ids, and so is the comment.
    demo.get("G1_01").name = "WA-102"
    text = DatExporter.to_dat_text(demo, ["G1_01", "G1_02"], focal_id="G1_02")
    assert "; Focal individual: G1_02" in text.splitlines()


def test_ibd_founders_are_named(monkeypatch):
    eng = PmpParser.from_dat_text(read_fixture("binko_ibd.ped")).engine
    founder = eng.dat_meta["founder_order"][0]
    eng.get(founder).name = "Founder One"
    monkeypatch.setattr(api, "_engine", eng)
    group = next(iter(eng.ibd))
    hap = api.get_haplotypes(linkage_group=group)
    assert hap["founders"][0] == founder                          # ids stay the key
    assert hap["founder_names"][0] == "Founder One"
    rows = [a for p in api.get_individual(founder)["ibd"] for h in p["homologues"] for a in h]
    assert {(a["founder"], a["founder_name"]) for a in rows} == {(founder, "Founder One")}
