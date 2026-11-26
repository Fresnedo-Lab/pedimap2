"""
A .dat export writes every locus as Pedimap 1.x requires (dat-format.md
§6.3–6.4): a LOCUS line with ALLELENAMES for every locus of the map, and an
ALLELES section for every locus, empty where no exported individual has
data. Data without allele names (the demo data, JSON files) gets them from
its alleles. Each export reads back unchanged.

Run: cd backend && python -m pytest tests/test_dat_allele_sections.py -v
"""
import asyncio
import io
import json
import os
import re

import pytest
from fastapi import UploadFile

import api
import marker_data
from pmp_parser import DatExporter, PmpParser
from sample_data import load_sample_data
from tests.reader_spec import read_fixture

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


@pytest.fixture(autouse=True)
def keep_the_api_engine():
    before = api._engine
    yield
    api._engine = before


def _example():
    with open(os.path.join(FIXTURES, "Example.dat"), encoding="utf-8") as fh:
        return PmpParser.from_dat_text(fh.read()).engine


def _sections(text: str):
    """(map loci, {locus: ALLELENAMES names or None}, {ALLELES locus: row count})."""
    lines = [line.split(";")[0].rstrip() for line in text.splitlines()]
    map_loci, names, alleles = [], {}, {}
    block, locus = None, None
    for line in lines:
        head = line.split()[0] if line.split() else ""
        if head in ("MAP", "LOCUS", "ALLELES", "LINKAGEGROUP", "IBDPOSITION", "IBDPOSITIONS",
                    "PEDIGREE"):
            block = head
            if head == "LOCUS":
                locus = line.split()[1]
                names[locus] = None
            elif head == "ALLELES":
                locus = line.split()[1]
                alleles[locus] = 0
            continue
        if head == "ALLELENAMES":
            names[locus] = line.split()[1:]
        elif head and block == "MAP":
            map_loci.append(head)
        elif head and block == "ALLELES":
            alleles[locus] += 1
    return map_loci, names, alleles


def _assert_every_locus_written(text: str, loci):
    map_loci, names, alleles = _sections(text)
    assert map_loci == loci
    assert list(names) == loci and all(n is not None for n in names.values()), names
    assert list(alleles)[:len(loci)] == loci


def _codes(eng, iid, marker, n):
    """The codes of a genotype; data without codes (the demo data) is written
    with code 0, the format having one after every allele."""
    codes = [int(c) for c in eng.marker_codes.get(iid, {}).get(marker, [])]
    return codes + [0] * (n - len(codes))


def _genotypes(eng, name_of=lambda i: i):
    """Every genotype and code by individual name: what must read back unchanged."""
    return {name_of(i): {mk: (list(a), _codes(eng, i, mk, len(a)))
                         for mk, a in eng.get(i).markers.items()}
            for i in eng.all_ids()}


def _map(eng):
    return [(m.name, m.linkage_group, m.position_cM, list(m.founder_alleles)) for m in eng.markers]


# ── Demo data ────────────────────────────────────────────────────────────────

def test_demo_data_exports_every_locus():
    demo = load_sample_data()
    loci = [m.name for m in demo.markers]
    assert not any(m.allele_names for m in demo.markers)          # none of its own
    text = DatExporter.to_dat_text(demo)
    _assert_every_locus_written(text, loci)
    _, names, alleles = _sections(text)
    assert names["CH-Vf1"] == ["a", "b", "c", "d"]                  # from its alleles
    # Loci where no individual has data: empty ALLELENAMES, ALLELES without rows.
    assert names["Hi02c07"] == [] and alleles["Hi02c07"] == 0
    assert alleles["CH-Vf1"] == sum("CH-Vf1" in demo.get(i).markers for i in demo.all_ids())


def test_demo_data_reads_back_unchanged():
    demo = load_sample_data()
    text = DatExporter.to_dat_text(demo)
    back = PmpParser.from_dat_text(text).engine
    name_of = lambda i: demo.get(i).name                          # the file names them
    assert _genotypes(back) == _genotypes(demo, name_of)
    assert _map(back) == _map(demo)
    for m in demo.markers:                                         # the same coloring
        assert (marker_data.marker_values(back, m.name)["allele_names"]
                == marker_data.marker_values(demo, m.name)["allele_names"])
    assert DatExporter.to_dat_text(back) == text                   # and stays so


# ── A JSON file without allele names ─────────────────────────────────────────

def _json_without_allele_names():
    """Example.dat saved as JSON, without its allele names and with no data at
    SSR10; Elstar keeps its null allele "$" at SSR1."""
    api._engine = _example()
    data = json.loads(api.export_json().body)
    for m in data["markers"]:
        m["allele_names"] = []
    for ind in data["individuals"].values():
        ind["markers"].pop("SSR10", None)
    for codes in (data.get("marker_codes") or {}).values():
        codes.pop("SSR10", None)
    return json.dumps(data)


def _open_json(text: str):
    reply = asyncio.run(api.load_file(
        dat_file=UploadFile(file=io.BytesIO(text.encode("utf-8")), filename="example.json"),
        pmp_file=None))
    assert reply["loaded"] == "json"
    return api._engine


def test_a_json_file_exports_every_locus():
    eng = _open_json(_json_without_allele_names())
    loci = [m.name for m in eng.markers]
    text = api.export_dat().body.decode()
    _assert_every_locus_written(text, loci)
    _, names, alleles = _sections(text)
    # No genotypes at SSR10: no rows, and the names of its founder alleles.
    ssr10 = next(m for m in eng.markers if m.name == "SSR10")
    assert alleles["SSR10"] == 0
    assert names["SSR10"] == sorted(set(ssr10.founder_alleles) - {"-"}, key=float) != []
    # The alleles found at SSR1 and its founder alleles, in numeric order;
    # not the null allele "$" nor the unknown "-" (both declared in the header).
    original = next(m for m in _example().markers if m.name == "SSR1").allele_names
    assert names["SSR1"] == sorted(names["SSR1"], key=float)
    assert set(names["SSR1"]) <= set(original) and not {"$", "-"} & set(names["SSR1"])
    assert re.search(r"^NULLHOMOZ\s+=\s+\$", text, re.M)


def test_a_json_file_reads_back_unchanged():
    eng = _open_json(_json_without_allele_names())
    text = api.export_dat().body.decode()
    back = PmpParser.from_dat_text(text).engine
    assert _genotypes(back) == _genotypes(eng)
    assert _map(back) == _map(eng)
    assert back.ibd == eng.ibd
    assert DatExporter.to_dat_text(back) == text


# ── A subset of a .dat file ──────────────────────────────────────────────────

def test_a_subset_keeps_the_sections_of_loci_without_its_data():
    # Binko's dummy founders have no genotype rows (reader spec 5.9): exported
    # alone, one has no data at any locus, and every locus keeps its sections.
    eng = PmpParser.from_dat_text(read_fixture("binko_legacy.ped")).engine
    loci = [m.name for m in eng.markers]
    dummy = "DUMMY_G1_007_F"
    assert eng.get(dummy).markers == {}
    text = DatExporter.to_dat_text(eng, [dummy], outside_parents="unknown")
    _assert_every_locus_written(text, loci)
    _, names, alleles = _sections(text)
    assert alleles == {m: 0 for m in loci}
    assert names == {m.name: m.allele_names for m in eng.markers}  # as read
    back = PmpParser.from_dat_text(text).engine
    assert _genotypes(back) == {dummy: {}}
    # Exported again (now the whole file), the same apart from the subset's
    # header comments.
    body = lambda t: [line for line in t.splitlines() if not line.startswith(";")]
    assert body(DatExporter.to_dat_text(back)) == body(text)
