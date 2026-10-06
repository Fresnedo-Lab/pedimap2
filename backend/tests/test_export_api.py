"""
Tests for POST /api/export/dat (subpopulation export) and GET (whole population).
"""
import asyncio
import io
import os

import pytest
from fastapi import HTTPException, UploadFile

import api
from pmp_parser import PmpParser

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


@pytest.fixture
def public(monkeypatch):
    with open(os.path.join(FIXTURES, "apple_public.dat"), encoding="utf-8") as fh:
        eng = PmpParser.from_dat_text(fh.read()).engine
    monkeypatch.setattr(api, "_engine", eng)
    return eng


def _header(text: str) -> list:
    """Header comments, without the per-trait PEDIMAP2 TRAITTYPE lines."""
    return [line for line in text.splitlines()
            if line.startswith(";") and not line.startswith("; PEDIMAP2 ")]


def _jonathan_and_descendants(eng):
    return ["Jonathan", *eng.in_order(eng.descendants("Jonathan"))]


def test_subpopulation_header_records_the_selection(public):
    req = api.DatExportRequest(ids=_jonathan_and_descendants(public),
                               focal_id="Jonathan", descendants=True)
    text = api.export_dat_subset(req).body.decode()
    assert _header(text) == [
        "; Exported by Pedimap 2",
        "; Subpopulation of: Apple-Public",
        "; Focal individual: Jonathan",
        "; Selection: focal + descendants",
        # Idared, Melrose and Monroe each have a different father outside the set.
        "; Individuals: 4 selected; 3 outside parent(s) added as founder rows",
    ]
    exported = PmpParser.from_dat_text(text).engine
    assert {"Wagener", "Red-Delicious", "Rome-Beauty"} <= set(exported.all_ids())


def test_replace_outside_parents_gives_a_closed_set(public):
    ids = _jonathan_and_descendants(public)
    req = api.DatExportRequest(ids=ids, focal_id="Jonathan", descendants=True,
                               replace_outside_parents=True)
    text = api.export_dat_subset(req).body.decode()
    assert "; Individuals: 4 selected; 3 outside parent(s) replaced with unknown" in text
    exported = PmpParser.from_dat_text(text).engine
    assert sorted(exported.all_ids()) == sorted(ids)
    assert exported.get("Idared").male_parent is None


def test_without_ids_exports_the_whole_population(public):
    text = api.export_dat_subset(api.DatExportRequest()).body.decode()
    assert _header(text) == ["; Exported by Pedimap 2"]
    assert PmpParser.from_dat_text(text).engine.count() == public.count()
    assert api.export_dat().body.decode() == text      # same as GET


def test_ibd_subset_without_its_founders_reloads_intact(monkeypatch):
    # Example.dat: 81015-045's IBD vectors put probability on founder alleles of
    # GoldenD, IngridM, Jonathan and Cox. Export it with its parents (default
    # mode), which leaves every founder out of the file, then reload it through
    # the same upload route the app uses.
    with open(os.path.join(FIXTURES, "Example.dat"), encoding="utf-8") as fh:
        source = PmpParser.from_dat_text(fh.read()).engine
    monkeypatch.setattr(api, "_engine", source)
    text = api.export_dat_subset(api.DatExportRequest(ids=["81015-045"])).body.decode()

    reply = asyncio.run(api.load_file(
        dat_file=UploadFile(file=io.BytesIO(text.encode()), filename="sub.dat"), pmp_file=None))
    reloaded = api.get_engine()
    assert reply["individuals"] == 3
    assert sorted(reloaded.all_ids()) == ["81015-045", "Elise", "Elstar"]
    founders = {"GoldenD", "IngridM", "Jonathan", "Cox"}
    assert not founders & set(reloaded.all_ids())           # founders are not in the file

    # Founder-allele definitions are kept exactly as in the source population...
    assert ([(m.name, m.founder_alleles) for m in reloaded.markers]
            == [(m.name, m.founder_alleles) for m in source.markers])
    # ...so the IBD rows are unchanged, still 2 x 8 probabilities per individual.
    assert set(reloaded.ibd) == set(source.ibd)
    for lg, positions in source.ibd.items():
        assert set(reloaded.ibd[lg]) == set(positions)
        for pos, rows in positions.items():
            for iid in reloaded.all_ids():
                assert reloaded.ibd[lg][pos][iid] == rows[iid]
                assert [len(h) for h in reloaded.ibd[lg][pos][iid]] == [8, 8]
    assert reloaded.ibd["A"]["0"]["81015-045"][0][0] == 0.22     # GoldenD's allele 1


def test_unknown_ids_are_a_bad_request(public):
    with pytest.raises(HTTPException) as exc:
        api.export_dat_subset(api.DatExportRequest(ids=["Jonathan", "Nobody"]))
    assert exc.value.status_code == 400
