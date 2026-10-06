"""
Tests for /api/individual/{id}: relatives come back as ordered, named lists
that the details panel turns into counts with clickable links.
"""
import os

import pytest

import api
from pmp_parser import PmpParser
from tests.dat_rows import pedigree_rows

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")

# Private, gitignored fixture — tests that need it skip when it is absent (CI).
TRANSAPPLE = os.path.join(FIXTURES, "TransApple_Consolidated.dat")
needs_transapple = pytest.mark.skipif(
    not os.path.exists(TRANSAPPLE),
    reason="TransApple_Consolidated.dat is private and not in the repo",
)


def _load(monkeypatch, path):
    with open(path, encoding="utf-8") as fh:
        eng = PmpParser.from_dat_text(fh.read()).engine
    monkeypatch.setattr(api, "_engine", eng)
    return eng


@pytest.fixture
def public(monkeypatch):
    return _load(monkeypatch, os.path.join(FIXTURES, "apple_public.dat"))


@pytest.fixture
def transapple(monkeypatch):
    return _load(monkeypatch, TRANSAPPLE)


# ── Public fixture (always runs) ──────────────────────────────────────────────

def test_relatives_are_named_lists(public):
    # Jonathan is the female parent in three crosses with different males.
    detail = api.get_individual("Jonathan")
    assert [r["id"] for r in detail["descendants"]] == ["Idared", "Melrose", "Monroe"]
    assert all(set(r) == {"id", "name"} for r in detail["descendants"])
    assert [r["id"] for r in api.get_individual("Idared")["siblings"]] == ["Melrose", "Monroe"]


def test_relatives_follow_pedigree_order(public):
    order = public.all_ids()
    for ind in ("Gala", "Golden-Delicious"):
        for key in ("ancestors", "descendants", "siblings"):
            ids = [r["id"] for r in api.get_individual(ind)[key]]
            assert ids == sorted(ids, key=order.index), (ind, key)


def test_panel_traits_and_parents(public):
    detail = api.get_individual("Elstar")
    assert detail["traits"] == {
        "S_1": "S3", "S_2": "S5", "S1_S2": "S3S5", "BATCH": "B1", "S_QC": "0"}
    assert (detail["female_parent"], detail["male_parent"]) == (
        "Golden-Delicious", "Ingrid-Marie")


def test_incompatible_selfing_keeps_its_qc_flag(public):
    detail = api.get_individual("Fuji-self-01")
    assert detail["cross_type"] == "self"
    assert detail["traits"]["S_QC"] == "2"


# ── Private TransApple fixture (local only) ───────────────────────────────────
# Every expectation is derived from the private file at run time, so no names,
# counts or values from that unpublished data appear in this public repository.

@needs_transapple
def test_private_fixture_largest_family_is_a_full_named_list(transapple):
    top = max(transapple.all_ids(), key=lambda i: len(transapple.descendants(i)))
    detail = api.get_individual(top)
    assert len(detail["descendants"]) == len(transapple.descendants(top)) > 0
    assert all(set(r) == {"id", "name"} for r in detail["descendants"])


@needs_transapple
def test_private_fixture_panel_traits_match_source_rows(transapple):
    with open(TRANSAPPLE, encoding="utf-8") as fh:
        source = fh.read()
    unknown = set(transapple.dat_meta["unknown"])
    rows = pedigree_rows(source)
    trait_names = next(line.split() for line in source.splitlines()
                       if line.split()[:1] == ["NAME"])[3:]
    for toks in rows:
        name, values = toks[0], toks[3:]          # NAME, FEMALE, MALE, traits...
        expected = {t: v for t, v in zip(trait_names, values) if v not in unknown}
        assert api.get_individual(name)["traits"] == expected, name
