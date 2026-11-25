"""Pedimap 2 JSON (docs/reference/json-format.md): Save as JSON writes the
whole population with "format" and "format_version"; opening the file again
gives the same data; older, newer and foreign files are handled as the
document says."""

import asyncio
import io
import json
import os

import pytest
from fastapi import HTTPException, UploadFile

import api
import marker_data
from pedigree_engine import PedigreeEngine
from pmp_parser import PmpParser
from tests.reader_spec import read_fixture

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


@pytest.fixture(autouse=True)
def keep_the_api_engine():
    """These tests replace the API's pedigree; put it back afterwards."""
    before = api._engine
    yield
    api._engine = before


def _engine(name: str) -> PedigreeEngine:
    if name in ("Example.dat", "apple_public.dat"):
        with open(os.path.join(FIXTURES, name), encoding="utf-8") as fh:
            return PmpParser.from_dat_text(fh.read()).engine
    return PmpParser.from_dat_text(read_fixture(name)).engine


def _saved(engine: PedigreeEngine) -> dict:
    """What Save as JSON writes for `engine`, as a file holds it."""
    api._engine = engine
    return json.loads(api.export_json().body)


def _open(data, name: str = "pedigree.json") -> dict:
    text = data if isinstance(data, str) else json.dumps(data)
    return asyncio.run(api.load_file(
        dat_file=UploadFile(file=io.BytesIO(text.encode("utf-8")), filename=name), pmp_file=None))


def test_the_file_starts_with_its_format_and_version():
    saved = _saved(_engine("Example.dat"))
    assert list(saved)[:2] == ["format", "format_version"]
    assert (saved["format"], saved["format_version"]) == ("pedimap2-json", 1)


@pytest.mark.parametrize("name", ["Example.dat", "apple_public.dat", "binko_ibd.ped",
                                  "flexqtl_routeB_sim_small.ped"])
def test_opening_a_saved_file_gives_the_same_data(name):
    original = _engine(name)
    saved = _saved(original)
    reply = _open(saved)
    assert reply["loaded"] == "json" and reply["warnings"] == []
    again = api._engine
    # Every field, as the files hold them.
    assert json.loads(json.dumps(again.to_dict())) == json.loads(json.dumps(original.to_dict()))
    assert marker_data.parent_labels(again) == marker_data.parent_labels(original)
    # The IBD bars of every linkage group are the same.
    for group in {m.linkage_group for m in original.markers}:
        if original.ibd.get(group):
            assert marker_data.haplotypes(again, group) == marker_data.haplotypes(original, group)


def test_json_of_pedimap_2_4_and_earlier_opens_as_version_1():
    """Files saved before "format" existed (the API's JSON) open without a
    warning."""
    old = _engine("Example.dat").to_dict()
    assert "format" not in old
    reply = _open(old)
    assert reply["warnings"] == [] and reply["individuals"] == 8


def test_a_newer_version_opens_with_a_warning():
    newer = {**_saved(_engine("Example.dat")), "format_version": 2, "something_new": [1, 2]}
    reply = _open(newer)
    assert reply["individuals"] == 8
    assert len(reply["warnings"]) == 1
    assert "format version 2" in reply["warnings"][0] and "reads version 1" in reply["warnings"][0]


@pytest.mark.parametrize("text, message", [
    ('{"format": "other-tool", "individuals": {}}', "Not a Pedimap 2 JSON file (its format is 'other-tool')."),
    ("[1, 2, 3]", "Not a Pedimap 2 JSON file: it does not hold a pedigree."),
    ("{not json", "Not a JSON file"),
])
def test_other_files_are_refused_with_a_plain_message(text, message):
    with pytest.raises(HTTPException) as err:
        _open(text)
    assert err.value.status_code == 400
    assert str(err.value.detail).startswith(message)


def test_the_example_in_json_format_md_opens_and_saves_the_same():
    """The document's example is a complete file Pedimap opens and saves back
    unchanged (apart from fields Pedimap fills in, here none)."""
    import re
    doc = open(os.path.join(os.path.dirname(__file__), "..", "..", "docs", "reference", "json-format.md"),
               encoding="utf-8").read()
    example = json.loads(re.search(r"## 10\. Example.*?```json\n(.*?)```", doc, re.S).group(1))
    reply = _open(example)
    assert reply["individuals"] == 2 and reply["warnings"] == []
    assert json.loads(api.export_json().body) == example
