"""
Tests for DatExporter: .dat export must read back to the same pedigree.

Run: cd backend && python -m pytest tests/ -v
"""
import os

import pytest

from pmp_parser import DatExporter, DatExportError, PmpParser
from sample_data import load_sample_data
from tests.dat_rows import pedigree_rows

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")

# TransApple_Consolidated.dat is unpublished breeding data: it is gitignored,
# so these tests run where a copy exists locally and skip everywhere else (CI).
# apple_public.dat carries the same columns and cases using public cultivars.
TRANSAPPLE = "TransApple_Consolidated.dat"
needs_transapple = pytest.mark.skipif(
    not os.path.exists(os.path.join(FIXTURES, TRANSAPPLE)),
    reason=f"{TRANSAPPLE} is private and not in the repo; copy it into tests/fixtures/ to run",
)


def _read(name: str) -> str:
    with open(os.path.join(FIXTURES, name), encoding="utf-8", errors="replace") as fh:
        return fh.read()


def _parse(text: str):
    return PmpParser.from_dat_text(text).engine


def _row(dat_text: str, name: str) -> list:
    """Tokens of the first line whose first token is ``name``."""
    for line in dat_text.splitlines():
        toks = line.split()
        if toks and toks[0] == name:
            return toks
    raise AssertionError(f"no row for {name!r}")


# ── Required round-trip ───────────────────────────────────────────────────────

@pytest.mark.parametrize("name", [
    "Example.dat",
    "apple_public.dat",
    pytest.param(TRANSAPPLE, marks=needs_transapple),
])
def test_round_trip_is_lossless(name):
    original = _parse(_read(name))
    exported = DatExporter.to_dat_text(original)
    reparsed = _parse(exported)

    assert reparsed.to_dict() == original.to_dict()
    # Individuals are emitted in topological order; that order must survive too.
    assert list(reparsed.to_dict()["individuals"]) == list(original.to_dict()["individuals"])
    # Exporting the re-read data reproduces the same text (export is a fixed point).
    assert DatExporter.to_dat_text(reparsed) == exported


# ── What gets written ─────────────────────────────────────────────────────────

def test_header_keywords_use_values_read_in():
    exported = DatExporter.to_dat_text(_parse(_read("Example.dat")))
    header = {line.split("=")[0].strip(): line.split("=", 1)[1].strip()
              for line in exported.splitlines() if "=" in line}
    assert header == {
        "POPULATION": "Apples",
        "UNKNOWN": "* -",       # both symbols, display symbol first
        "NULLHOMOZ": "$",
        "NALLELES": "8",
        "PLOIDY": "2",
    }


@pytest.mark.parametrize("name", ["apple_public.dat", pytest.param(TRANSAPPLE, marks=needs_transapple)])
def test_trait_columns_keep_original_order(name):
    source = _read(name)
    exported = DatExporter.to_dat_text(_parse(source))
    assert _row(exported, "NAME") == _row(source, "NAME")


def test_selfing_written_as_parent_twice_exports_as_keyword():
    source = _read("apple_public.dat")
    assert _row(source, "Fuji-self-01")[1:3] == ["Fuji", "Fuji"]
    exported = DatExporter.to_dat_text(_parse(source))
    assert _row(exported, "Fuji-self-01")[1:3] == ["Fuji", "*SELF"]


@needs_transapple
def test_private_fixture_single_parent_descent_uses_keywords():
    # Expectations come from the private file at run time; nothing from its
    # contents is written into this public repository.
    source = _read(TRANSAPPLE)
    unknown = set(_parse(source).dat_meta["unknown"])
    exported = DatExporter.to_dat_text(_parse(source))
    rows = pedigree_rows(source)

    selfs = [r for r in rows if r[1] == r[2] and r[1] not in unknown]
    keyworded = [r for r in rows if r[1].startswith("*") or r[2].startswith("*")]
    assert selfs and keyworded, "fixture no longer exercises single-parent descent"
    for name, parent, _ in (r[:3] for r in selfs):
        assert _row(exported, name)[1:3] == [parent, "*SELF"]
    for r in keyworded:
        assert sorted(_row(exported, r[0])[1:3]) == sorted(r[1:3])


def test_all_keywords_quoted_names_and_reversed_columns_round_trip():
    src = (
        "UNKNOWN = ? -\n"
        "PEDIGREE\n"
        'NAME            MALE              FEMALE            Taste\n'
        '"Golden Delicious"  ?            ?                 sweet\n'
        'Jonathan        ?                 ?                 "very tart"\n'
        'Selfed          "Golden Delicious" "Golden Delicious" ?\n'
        'Haploid         Jonathan          *DH               sweet\n'
        'Sport           *MUT              Jonathan          tart\n'
        'Clone           "Golden Delicious" *VP              sweet\n'
        'Kid             Jonathan          "Golden Delicious" tart\n'
    )
    original = _parse(src)
    exported = DatExporter.to_dat_text(original)

    assert '"Golden Delicious"' in exported and '"very tart"' in exported
    assert "*SELF" in exported and "*DH" in exported
    assert "*MUT" in exported and "*VP" in exported
    assert _row(exported, "NAME")[1:3] == ["MALE", "FEMALE"]   # labels as read
    reparsed = _parse(exported)
    assert reparsed.to_dict() == original.to_dict()
    kid = reparsed.get("Kid")
    assert (kid.female_parent, kid.male_parent) == ("Golden Delicious", "Jonathan")


def test_marker_and_ibd_sections_written():
    original = _parse(_read("Example.dat"))
    exported = DatExporter.to_dat_text(original)
    lines = exported.splitlines()

    assert [l for l in lines if l.startswith("LINKAGEGROUP")] == [
        "LINKAGEGROUP A", "LINKAGEGROUP B", "LINKAGEGROUP C"]
    assert sum(l.startswith("ALLELES ") for l in lines) == 5
    assert sum(l.startswith("IBDPOSITION ") for l in lines) == 5
    # Color codes on observed alleles survive (Elstar SSR1 is coded 2 / 2).
    assert _parse(exported).marker_codes["Elstar"]["SSR1"] == ["2", "2"]


# ── Subsets ───────────────────────────────────────────────────────────────────

def _check_subset_export(source, ids, text, mode="include"):
    """Invariants for any subset export; returns the re-parsed engine."""
    ids = set(ids)
    sub = _parse(text)                                     # 1. it re-parses
    outside = {p for i in ids
               for p in (source.get(i).female_parent, source.get(i).male_parent)
               if p is not None and p not in ids}
    assert set(sub.all_ids()) == (ids | outside if mode == "include" else ids)
    for iid in sub.all_ids():
        ind = sub.get(iid)
        for parent in (ind.female_parent, ind.male_parent):  # 2. in file or unknown
            assert parent is None or parent in sub.all_ids(), (iid, parent)
        assert ind.traits == source.get(iid).traits, iid    # 3. traits unchanged
    for iid in outside & set(sub.all_ids()):                # added as founders
        assert (sub.get(iid).female_parent, sub.get(iid).male_parent) == (None, None)
    return sub


def test_subset_adds_outside_parents_as_founder_rows():
    source = _parse(_read("apple_public.dat"))
    text = DatExporter.to_dat_text(source, ids=["Gala"])
    sub = _check_subset_export(source, ["Gala"], text)

    # Kidd's-Orange-Red is a cross in the source; here it becomes a founder row
    # that keeps its own trait values, so Gala's parentage is not lost.
    assert (sub.get("Gala").female_parent, sub.get("Gala").male_parent) == (
        "Kidd's-Orange-Red", "Golden-Delicious")
    assert sub.get("Golden-Delicious").traits["S1_S2"] == "S2S3"
    assert "; Subpopulation of: Apple-Public" in text
    assert "; Individuals: 1 selected; 2 outside parent(s) added as founder rows" in text


def test_subset_can_replace_outside_parents_with_unknown():
    source = _parse(_read("Example.dat"))
    ids = ["Elstar", "Elise", "81015-045"]
    text = DatExporter.to_dat_text(source, ids=ids, outside_parents="unknown")
    sub = _check_subset_export(source, ids, text, mode="unknown")

    assert sub.get("Elstar").female_parent is None          # GoldenD not exported
    assert (sub.get("81015-045").female_parent, sub.get("81015-045").male_parent) == (
        "Elstar", "Elise")
    assert set(sub.ibd["A"]["0"]) == set(ids)
    assert "; Individuals: 3 selected; 4 outside parent(s) replaced with unknown" in text


def test_subset_marker_and_ibd_rows_follow_the_ids():
    source = _parse(_read("Example.dat"))
    ids = ["Elstar", "Elise", "81015-045"]
    sub = _check_subset_export(source, ids, DatExporter.to_dat_text(source, ids=ids))
    # Selected individuals plus the 4 outside parents added as founders.
    expected = set(ids) | {"GoldenD", "IngridM", "Septer", "Cox"}
    for lg in sub.ibd:
        for pos in sub.ibd[lg]:
            assert set(sub.ibd[lg][pos]) == expected
            for iid in expected:
                assert sub.ibd[lg][pos][iid] == source.ibd[lg][pos][iid]
    assert {i for i in expected if sub.get(i).markers} == expected
    assert all(sub.get(i).markers == source.get(i).markers for i in expected)


@pytest.mark.parametrize("relation", ["ancestors", "descendants"])
@needs_transapple
def test_private_fixture_every_subpopulation_exports_cleanly(relation):
    # For every individual in the file, export focal + its ancestors or
    # descendants, as the subpopulation view does, and check the invariants.
    # Everything is derived at run time from the private file.
    source = _parse(_read(TRANSAPPLE))
    for focal in source.all_ids():
        ids = {focal, *getattr(source, relation)(focal)}
        _check_subset_export(source, ids, DatExporter.to_dat_text(source, ids=ids))


def test_unknown_ids_are_rejected():
    with pytest.raises(DatExportError):
        DatExporter.to_dat_text(_parse(_read("Example.dat")), ids=["Nobody"])


def test_sample_data_exports_by_name():
    # Sample data has ids like "F01" and display names; .dat uses names.
    eng = load_sample_data()
    reparsed = _parse(DatExporter.to_dat_text(eng))
    assert reparsed.count() == eng.count()
    assert sorted(reparsed.all_ids()) == sorted(eng.get(i).name for i in eng.all_ids())
