"""
Tests for POST /api/export/dat (subpopulation export) and GET (whole population).
"""
import os

import pytest
from fastapi import HTTPException

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
    return [line for line in text.splitlines() if line.startswith(";")]


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


def test_unknown_ids_are_a_bad_request(public):
    with pytest.raises(HTTPException) as exc:
        api.export_dat_subset(api.DatExportRequest(ids=["Jonathan", "Nobody"]))
    assert exc.value.status_code == 400
