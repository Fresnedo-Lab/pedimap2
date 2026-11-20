"""
Files written by FlexQTL 0.99130 and Binko.jl, read as the reader's
specification in docs/reference/flexqtl-binko-pedimap/ describes them.

The fixtures (backend/tests/fixtures/flexqtl_binko/) and their expected
content come with that specification; all their data are simulated.

Run: cd backend && python -m pytest tests/test_flexqtl_binko.py -v
"""
import asyncio
import io
import os
import re

import pytest
from fastapi import UploadFile

import api
from pmp_parser import DatExporter, DatParseError, PmpParser
from tests.reader_spec import content, difference, expected, read_fixture

FIXTURES = ["binko_legacy.ped", "binko_ibd.ped", "flexqtl_routeB_sim_small.ped"]
EXAMPLE = os.path.join(os.path.dirname(__file__), "fixtures", "Example.dat")
DUMMIES = ["DUMMY_G1_007_F", "DUMMY_G2_004_M"]     # binko_ibd.ped's dummy founders

_cache: dict = {}


def _text(name: str) -> str:
    if name not in _cache:
        _cache[name] = read_fixture(name)
    return _cache[name]


def _parse(text: str):
    return PmpParser.from_dat_text(text)


def _assert_content(result, fixture: str, want: dict = None) -> None:
    diff = difference(want or expected(fixture), content(result.engine, fixture))
    assert diff is None, diff


def _line(text: str, starts: str, after: int = 0) -> int:
    """1-based number of the first line from ``after`` on that starts with ``starts``."""
    lines = text.split("\n")
    return next(k + 1 for k in range(after, len(lines)) if lines[k].startswith(starts))


def _replace_line(text: str, number: int, new: str) -> str:
    lines = text.split("\n")
    lines[number - 1] = new
    return "\n".join(lines)


# ── The three fixtures ────────────────────────────────────────────────────────

@pytest.mark.parametrize("fixture", FIXTURES)
def test_fixture_reads_as_its_expected_content(fixture):
    result = _parse(_text(fixture))
    assert result.warnings == []
    _assert_content(result, fixture)


def test_flexqtl_sections_belong_to_the_groups_of_the_ibdpositions_lines():
    # The comment "; Linkage Group 1" was read as the group "Linkage", and the
    # sections of group 2 overwrote those of group 1 at the same positions.
    eng = _parse(_text("flexqtl_routeB_sim_small.ped")).engine
    assert list(eng.ibd) == ["1", "2"]
    assert [len(eng.ibd[g]) for g in eng.ibd] == [21, 21]
    assert sum(len(p) for p in eng.ibd.values()) == 42
    assert "0.000" in eng.ibd["1"] and "0.000" in eng.ibd["2"]
    assert any(eng.ibd["1"]["0.000"][i] != eng.ibd["2"]["0.000"][i] for i in eng.all_ids())


def test_binko_dummy_founders_have_their_own_founder_alleles():
    result = _parse(_text("binko_ibd.ped"))
    eng = result.engine
    order = eng.dat_meta["founder_order"]
    assert order == ["F001", "F002", "F003", "F004", "F005", "F006", *DUMMIES]
    # No rows in the file: probability 1 on their own alleles is supplied...
    supplied = eng.dat_meta["supplied_ibd_rows"]
    assert supplied == {"1": {"5.0000": DUMMIES, "20.0000": DUMMIES},
                        "3": {"30.0000": DUMMIES}}
    h1, h2 = eng.ibd["1"]["5.0000"]["DUMMY_G1_007_F"]
    assert (h1.index(1.0), h2.index(1.0), sum(h1), sum(h2)) == (12, 13, 1.0, 1.0)
    # ...and their genotypes are unknown: no ALLELES row, so no entry.
    assert all(eng.get(d).markers == {} for d in DUMMIES)


def test_example_founder_alleles_follow_the_founders_own_rows():
    # Example.dat lists Cox first among its founders, but Cox's own IBD row
    # puts it on founder alleles 7 and 8.
    with open(EXAMPLE, encoding="utf-8") as fh:
        eng = _parse(fh.read()).engine
    table = [i for i in eng.dat_meta["source_order"] if eng.get(i).female_parent is None]
    assert table == ["Cox", "GoldenD", "IngridM", "Jonathan"]
    assert eng.dat_meta["founder_order"] == ["GoldenD", "IngridM", "Jonathan", "Cox"]
    assert "supplied_ibd_rows" not in eng.dat_meta


def test_factor0_is_metadata_not_a_trait():
    eng = _parse(_text("binko_legacy.ped")).engine
    assert [t.name for t in eng.traits] == ["Gwrite", "Block", "y"]
    assert eng.dat_meta["factor0"]["column"] == 0
    values = eng.dat_meta["factor0"]["values"]
    assert (values["F001"], values["G1_001"], values["G1_007"]) == ("0", "1", "2")


def test_factor0_against_the_pedigree_warns():
    text = _text("binko_legacy.ped")
    number = _line(text, "G1_001 ")
    row = text.split("\n")[number - 1]
    result = _parse(_replace_line(text, number, re.sub(r"(F002\s+)1", r"\g<1>2", row, count=1)))
    assert len(result.warnings) == 1
    assert "FACTOR0 does not match the pedigree for 1 individual(s)" in result.warnings[0]
    assert f"'G1_001' on line {number}: 2, expected 1" in result.warnings[0]
    assert result.engine.dat_meta["factor0"]["values"]["G1_001"] == "2"     # kept as read


def test_genotype_codes_and_allele_order_are_kept():
    eng = _parse(_text("binko_legacy.ped")).engine
    # G1_001 at M1_001 is "G 1 A 1": filled in, first allele G (spec 4.2).
    assert eng.get("G1_001").markers["M1_001"] == ["G", "A"]
    assert eng.marker_codes["G1_001"]["M1_001"] == [1, 1]
    codes = {c for by_marker in eng.marker_codes.values() for cs in by_marker.values() for c in cs}
    assert codes == {0, 1, 2, 5, 7}
    assert PmpParser.from_dat_text(DatExporter.to_dat_text(eng)).engine.marker_codes == eng.marker_codes


# ── Round trips ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("fixture", FIXTURES)
def test_dat_export_reads_back_the_same(fixture):
    original = _parse(_text(fixture)).engine
    exported = DatExporter.to_dat_text(original)
    again = _parse(exported)
    assert again.warnings == []
    assert again.engine.to_dict() == original.to_dict()
    _assert_content(again, fixture)
    assert DatExporter.to_dat_text(again.engine) == exported


def _ibd_tokens(text: str) -> list:
    """The name and value tokens of every IBDPOSITION data row, in order."""
    rows, in_ibd = [], False
    for line in text.split("\n"):
        toks = line.split(";")[0].split()
        if toks[:1] == ["IBDPOSITION"]:
            in_ibd = True
        elif in_ibd and toks and toks[0] not in ("IBDPOSITIONS", "ALLELES"):
            rows.append(toks)
    return rows


@pytest.mark.parametrize("fixture", ["Example.dat", "flexqtl_routeB_sim_small.ped",
                                     "binko_ibd.ped"])
def test_dat_export_writes_the_probabilities_as_read(fixture):
    # Exact 0 and 1 keep their form ("0", "1.0"), as do rounded ones ("0.00").
    if fixture == "Example.dat":
        with open(EXAMPLE, encoding="utf-8") as fh:
            text = fh.read()
    else:
        text = _text(fixture)
    exported = DatExporter.to_dat_text(_parse(text).engine)
    want = _ibd_tokens(text)
    if fixture == "binko_ibd.ped":      # the dummy founders' supplied rows stay out
        assert not any(r[0] in DUMMIES for r in want)
    assert _ibd_tokens(exported) == want


def test_example_round_trip_is_unchanged():
    with open(EXAMPLE, encoding="utf-8") as fh:
        original = _parse(fh.read())
    assert original.warnings == []
    again = _parse(DatExporter.to_dat_text(original.engine))
    assert again.warnings == [] and again.engine.to_dict() == original.engine.to_dict()


def test_binko_file_without_dummy_founder_rows():
    # Binko's files before its commit 955aefa name a dummy founder as a parent
    # without giving it a row (spec 3.2, 5.2). Founders, map, genotypes and IBD
    # read the same; the two names are listed as parents without a row.
    text = "\n".join(line for line in _text("binko_ibd.ped").split("\n")
                     if line.split()[:1] not in ([d] for d in DUMMIES))
    result = _parse(text)
    eng = result.engine
    assert eng.dat_meta["parents_without_row"] == DUMMIES
    assert eng.dat_meta["founder_order"] == expected_founders("binko_ibd.ped")
    assert len(result.warnings) == 1 and "2 parent(s) have no row" in result.warnings[0]

    want = expected("binko_ibd.ped")
    want["pedigree"]["individuals"] = [i for i in want["pedigree"]["individuals"]
                                       if i["name"] not in DUMMIES]
    want["pedigree"]["parents_without_row"] = DUMMIES
    want["counts"]["individuals"] -= 2
    _assert_content(result, "binko_ibd.ped", want)


def expected_founders(fixture: str) -> list:
    alleles = expected(fixture)["ibd"]["founder_alleles"]
    return [a["founder"] for a in alleles if a["homologue"] == 1]


def test_subset_export_keeps_the_source_founder_alleles():
    source = _parse(_text("binko_ibd.ped")).engine
    ids = ["G2_001", "G2_004"]
    text = DatExporter.to_dat_text(source, ids=ids)
    assert "; PEDIMAP2 IBDFOUNDERS SOURCE" in text
    sub = _parse(text)
    assert sub.warnings == []
    for group, by_pos in sub.engine.ibd.items():
        for pos, rows in by_pos.items():
            for iid in rows:
                assert rows[iid] == source.ibd[group][pos][iid]
    # A subset written by Pedimap 2.2.2 or earlier has no directive, only its
    # head; it reads the same. Without either, its founders do not fit NALLELES.
    old = text.replace("; PEDIMAP2 IBDFOUNDERS SOURCE\n", "")
    assert _parse(old).engine.ibd == sub.engine.ibd
    with pytest.raises(DatParseError, match="NALLELES is 16, but the pedigree has"):
        _parse(old.replace("; Subpopulation of:", "; Taken from:"))


# ── What a reader tolerates (spec 7.1) ────────────────────────────────────────

def _lower_keywords(text: str) -> str:
    keywords = r"(POPULATION|UNKNOWN|NULLHOMOZ|CONFIRMEDNULL|PLOIDY|NALLELES|PEDIGREE|" \
               r"LINKAGEGROUP|MAP|LOCUS|ALLELENAMES|FOUNDERALLELES|IBDPOSITIONS|ALLELES|" \
               r"IBDPOSITION)\b"
    return re.sub(r"(?m)^" + keywords, lambda m: m.group(1).lower(), text)


def _comments_between_ibd_rows(text: str) -> str:
    out, in_ibd = [], False
    for line in text.split("\n"):
        out.append(line)
        in_ibd = in_ibd or line.startswith("IBDPOSITION ")
        if in_ibd and line and not line.startswith(";"):
            out.append("   ; a comment row")
    return "\n".join(out)


TOLERATED = {
    "CRLF line ends":            lambda t: t.replace("\n", "\r\n"),
    "tabs and trailing blanks":  lambda t: "\n".join(re.sub(r" +", "\t", l) + " \t "
                                                     for l in t.split("\n")),
    "no final line end":         lambda t: t.rstrip("\n"),
    "keywords in lower case":    _lower_keywords,
    "comment rows in sections":  _comments_between_ibd_rows,
}


@pytest.mark.parametrize("change", TOLERATED)
@pytest.mark.parametrize("fixture", ["binko_legacy.ped", "binko_ibd.ped"])
def test_tolerated_form(fixture, change):
    result = _parse(TOLERATED[change](_text(fixture)))
    assert result.warnings == []
    _assert_content(result, fixture)


def test_comment_naming_another_group_warns():
    # The order of the IBDPOSITIONS lines decides; the comment only cross-checks.
    t = _text("binko_ibd.ped")
    n = _line(t, "IBDPOSITION 30.0000")
    result = _parse(_replace_line(t, n, "IBDPOSITION 30.0000 ; LG 2"))
    assert list(result.engine.ibd) == ["1", "3"]
    assert len(result.warnings) == 1
    assert f"the first is on line {n}: the comment says '2'" in result.warnings[0]
    assert "gives '3'. The order decides" in result.warnings[0]


def test_parent_without_row_names_the_closest_individual():
    result = _parse("PEDIGREE\nNAME FEMALE MALE\nElstar - -\nGoldenD - -\n"
                    "Kid elstr goldend\nOther Unrelated GoldenD\n")
    assert result.engine.get("Kid").female_parent == "elstr"     # kept as written
    assert result.engine.dat_meta["parents_without_row"] == ["elstr", "goldend", "Unrelated"]
    warning, = result.warnings
    assert warning.startswith(
        "3 parent(s) have no row of their own: 'elstr' (closest existing individual: "
        "'Elstar'), 'goldend' (closest existing individual: 'GoldenD'), 'Unrelated'. ")
    assert "added as a founder without data; a name may be a misspelling" in warning


def test_renamed_founder_is_suggested_for_its_old_name():
    # binko_legacy.ped with the row of F001 renamed F0001: its offspring still
    # name F001. F002 to F006 are one edit from F001 too; F0001 is the nearest.
    text = _text("binko_legacy.ped")
    number = _line(text, "F001 ")
    renamed = _replace_line(text, number, "F0001" + text.split("\n")[number - 1][4:])
    warning, = _parse(renamed).warnings
    assert warning.startswith("1 parent(s) have no row of their own: 'F001' (closest "
                              "existing individual: 'F0001'). ")
    # The same when an equally near name comes first in the table.
    swapped = _parse("PEDIGREE\nNAME FEMALE MALE\nF002 - -\nF0001 - -\nKid F001 F002\n")
    assert "'F001' (closest existing individual: 'F0001')" in swapped.warnings[0]


def _with_allele(settings: str, allele: str) -> str:
    return (f"{settings}PEDIGREE\nNAME PARENT1 PARENT2\nP - -\n"
            "LINKAGEGROUP 1\nMAP\nM 0\nLOCUS M\nALLELENAMES A B\n"
            f"ALLELES M\nP A 0 {allele} 0\n")


@pytest.mark.parametrize("settings, allele", [
    ("NULLHOMOZ = #\n", "#"),
    ("CONFIRMEDNULL = nul\n", "nul"),
    ("UNKNOWN = ? x\n", "x"),
    ("", "-"),                                  # the default UNKNOWN symbol
])
def test_allele_symbols_the_file_declares(settings, allele):
    assert _parse(_with_allele(settings, allele)).engine.get("P").markers["M"] == ["A", allele]


@pytest.mark.parametrize("settings, allele", [
    ("", "$"),                                  # no NULLHOMOZ line: "$" is not declared
    ("", "null"),                               # no CONFIRMEDNULL line
    ("NULLHOMOZ = #\n", "$"),
])
def test_allele_symbols_the_file_does_not_declare(settings, allele):
    row = settings.count("\n") + 10
    message = f"Line {row}: the allele {allele!r} of 'P' is not on the ALLELENAMES line"
    with pytest.raises(DatParseError, match="^" + re.escape(message)):
        _parse(_with_allele(settings, allele))


def test_ibd_data_needs_ploidy_2():
    text = ("PLOIDY = 4\nNALLELES = 4\nPEDIGREE\nNAME PARENT1 PARENT2\nP - -\n"
            "LINKAGEGROUP 1\nMAP\nM 0\nIBDPOSITIONS 0\nALLELES M\nP A 0 A 0 B 0 B 0\n"
            "IBDPOSITION 0 ; LG 1\nP 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1\n")
    with pytest.raises(DatParseError, match="^Line 12: IBD data for ploidy 4 is not supported yet"):
        _parse(text)
    # Without IBD data, the tetraploid markers and pedigree load.
    plain = text.replace("NALLELES = 4\n", "").replace("IBDPOSITIONS 0\n", "")
    eng = _parse(plain.split("IBDPOSITION 0")[0]).engine
    assert eng.ploidy == 4 and eng.get("P").markers["M"] == ["A", "A", "B", "B"]


def test_locus_without_index():
    text = re.sub(r"(?m)^(LOCUS\s+\S+)\s+\(\d+\)", r"\1", _text("binko_ibd.ped"))
    want = expected("binko_ibd.ped")
    for group in want["linkage_groups"]:
        for marker in group["markers"]:
            marker["index"] = None
    _assert_content(_parse(text), "binko_ibd.ped", want)


def test_probability_forms_and_any_code():
    # "0", "1.0", "0.50" and "0.2500" in one file; codes are any whole number.
    text = (
        "NALLELES = 4\nPEDIGREE\nNAME PARENT1 PARENT2\nP - -\nQ - -\nX P Q\n"
        "LINKAGEGROUP 1\nMAP\nM 0\nLOCUS M (1)\nALLELENAMES A B\n"
        "FOUNDERALLELES A B A B\nIBDPOSITIONS 0\n"
        "ALLELES M\nP A 0 B 0\nQ A 42 A 42\nX - 5 - 5\n"
        "IBDPOSITION 0 ; LG 1\nP 1.0 0 0 0 0 1.0 0 0\nQ 0 0 1.0 0 0 0 0 1.0\n"
        "X 0.50 0.5 0 0 0 0 0.2500 0.7500"
    )
    result = _parse(text)
    assert result.warnings == []
    eng = result.engine
    assert eng.ibd["1"]["0"]["X"] == [[0.5, 0.5, 0.0, 0.0], [0.0, 0.0, 0.25, 0.75]]
    assert eng.marker_codes["Q"]["M"] == [42, 42]
    assert eng.get("X").markers["M"] == ["-", "-"]


def test_sums_within_rounding_are_accepted_and_beyond_it_warned():
    # Two decimals: a homologue of m values not written as "0" may miss 1 by
    # m x 0.005 (spec 5.6). The first half, 0.51 + 0.50 = 1.01, is within
    # 2 x 0.005; 0.34 + 0.34 + 0.34 = 1.02 is beyond 3 x 0.005: a warning.
    def warnings(h2: str) -> list:
        return _parse(
            "NALLELES = 4\nPEDIGREE\nNAME PARENT1 PARENT2\nP - -\nQ - -\nX P Q\n"
            "LINKAGEGROUP 1\nIBDPOSITIONS 0\nIBDPOSITION 0 ; LG 1\n"
            f"X 0.51 0.50 0 0 {h2}\n").warnings
    assert warnings("0 0 0.50 0.50") == []
    warned = warnings("0.34 0 0.34 0.34")
    assert len(warned) == 1 and "homologue 2): 1.0200" in warned[0]
    assert "'X' on line 10" in warned[0]


# ── What a reader rejects, with the line number (spec 7.2) ────────────────────

def _section_row(text: str, section: str, name: str) -> int:
    return _line(text, name + " ", _line(text, section))


def _rejects():
    t = _text("binko_ibd.ped")
    cases = {}

    def case(label, number, changed, message):
        cases[label] = (changed, number, message)

    n = _line(t, "G1_001 ")
    case("pedigree row field count", n, _replace_line(t, n, t.split("\n")[n - 1] + " x"),
         "has 8 fields, but the caption has 7")
    n = _section_row(t, "ALLELES M1_001", "G1_001")
    case("ALLELES row of an unknown individual", n, _replace_line(t, n, "G9_999 G 1 A 1"),
         "ALLELES row of 'G9_999', which is not in the pedigree")
    case("allele not on ALLELENAMES", n, _replace_line(t, n, "G1_001 G 1 C 1"),
         "the allele 'C' of 'G1_001' is not on the ALLELENAMES line of 'M1_001'")
    case("ALLELES row field count", n, _replace_line(t, n, "G1_001 G 1 A"),
         "5 fields, not 4")
    case("code not a whole number", n, _replace_line(t, n, "G1_001 G 1 A x"),
         "the indicator code 'x' is not a whole number")
    n = _line(t, "FOUNDERALLELES")
    case("FOUNDERALLELES length", n, _replace_line(t, n, t.split("\n")[n - 1].rsplit(" ", 1)[0]),
         "FOUNDERALLELES lists 15 alleles; NALLELES is 16")
    n = _line(t, "NALLELES")
    case("FOUNDERALLELES without NALLELES", _line(t, "FOUNDERALLELES"), _replace_line(t, n, ""),
         "FOUNDERALLELES in a file without NALLELES")
    row = _section_row(t, "IBDPOSITION 5.0000", "G1_001")
    values = t.split("\n")[row - 1].split()
    case("IBD row length", row, _replace_line(t, row, " ".join(values[:-1])),
         "the IBD row of 'G1_001' has 31 values, expected 32")
    case("probability above 1", row,
         _replace_line(t, row, " ".join(values[:1] + ["1.5000"] + values[2:])),
         "the IBD row of 'G1_001' has a probability outside 0 to 1")
    case("non-founder without an IBD row", _line(t, "IBDPOSITION 5.0000"),
         _replace_line(t, row, ""), "has no row for G1_001; only a founder's probabilities")
    n = _line(t, "IBDPOSITION 20.0000")
    case("position against the IBDPOSITIONS lines", n,
         _replace_line(t, n, "IBDPOSITION 25.0000 ; LG 1"),
         "IBDPOSITION 25.0000 is section 2, but position 2 of the IBDPOSITIONS lines is 20.0000")
    n = _line(t, "IBDPOSITIONS 30.0000")
    case("fewer sections than positions", n,
         _replace_line(t, n, "IBDPOSITIONS 30.0000 40.0000"),
         "list 4 position(s), but 3 IBDPOSITION section(s) follow; none for 40.0000")
    n = _line(t, "IBDPOSITION 30.0000")
    case("more sections than positions", n,
         _replace_line(t, _line(t, "IBDPOSITIONS 30.0000"), "IBDPOSITIONS"),
         "IBDPOSITION section 3, but the IBDPOSITIONS lines list only 2 position(s)")
    n = _line(t, "F006 ")
    case("NALLELES against the founders", _line(t, "NALLELES"),
         _replace_line(t, n, t.split("\n")[n - 1] + "\nF999 - - 0 - - -"),
         "NALLELES is 16, but the pedigree has 9 founder(s): 2 founder alleles each make 18")
    f001 = _section_row(t, "IBDPOSITION 5.0000", "F001")
    f002 = _section_row(t, "IBDPOSITION 5.0000", "F002")
    copied = "F001 " + t.split("\n")[f002 - 1].split(None, 1)[1]
    case("two founders on the same founder alleles", f002, _replace_line(t, f001, copied),
         "the founder 'F002' has founder alleles 3 and 4, which belong to the founder 'F001'")
    spread = "F001 " + t.split("\n")[row - 1].split(None, 1)[1]
    case("founder row that is not its own", f001, _replace_line(t, f001, spread),
         "'F001' is a founder, but its IBD row is not 1 on 2 founder alleles of its own")
    n = _line(t, "M1_002 ")
    case("MAP row without a position", n, _replace_line(t, n, "M1_002 x"),
         "a MAP row is a locus name and a position")
    n = _line(t, "LOCUS          M1_002")
    case("LOCUS not in the group's MAP", n, _replace_line(t, n, "LOCUS M9_999 (2)"),
         "the locus 'M9_999' is not in the MAP of linkage group '1'")
    return cases


REJECTS = _rejects()


@pytest.mark.parametrize("label", REJECTS)
def test_rejected_with_line_number(label):
    text, number, message = REJECTS[label]
    with pytest.raises(DatParseError) as exc:
        _parse(text)
    assert str(exc.value).startswith(f"Line {number}: "), str(exc.value)
    assert message in str(exc.value), str(exc.value)


# ── The app ───────────────────────────────────────────────────────────────────

def test_load_reports_warnings(monkeypatch):
    monkeypatch.setattr(api, "_engine", api._engine)
    text = _text("binko_legacy.ped").replace(
        "G1_001               F005                 F002                             1",
        "G1_001               F005                 F002                             2")
    reply = asyncio.run(api.load_file(
        dat_file=UploadFile(file=io.BytesIO(text.encode()), filename="b.ped"), pmp_file=None))
    assert reply["individuals"] == 26
    assert len(reply["warnings"]) == 1 and "FACTOR0" in reply["warnings"][0]
    assert "FACTOR0" not in [t["name"] for t in api.get_pedigree()["traits"]]
