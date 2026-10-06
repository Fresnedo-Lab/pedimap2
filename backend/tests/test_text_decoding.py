"""
Tests for reading legacy (Windows-1252) and UTF-8 files, and for exports
always being UTF-8.
"""
import asyncio
import io

from fastapi import UploadFile

import api
from pmp_parser import DatExporter, PmpParser
from text_decoding import UTF8, WINDOWS_1252, decode_text

# A Pedimap 1.x-style file written by a Windows program: accented names, one of
# them ("Élise") used as a parent further down, and a Windows-1252-only
# character (the en dash, byte 0x96) in a trait value.
LEGACY_DAT = (
    "POPULATION = Pommes\n"
    "PEDIGREE\n"
    "NAME     FEMALE  MALE      Taste\n"
    "Kid      Élise   Mañana    sweet–tart\n"
    "Élise    -       -         sweet\n"
    "Mañana   -       -         tart\n"
).encode("cp1252")


def _upload(data: bytes, name: str) -> dict:
    return asyncio.run(api.load_file(
        dat_file=UploadFile(file=io.BytesIO(data), filename=name), pmp_file=None))


# ── decode_text ───────────────────────────────────────────────────────────────

def test_utf8_is_used_when_valid():
    assert decode_text("Élise".encode("utf-8")) == ("Élise", UTF8)


def test_utf8_bom_is_stripped():
    text, encoding = decode_text(b"\xef\xbb\xbfPOPULATION = X\n")
    assert (text, encoding) == ("POPULATION = X\n", UTF8)


def test_invalid_utf8_falls_back_to_windows_1252_without_replacement():
    text, encoding = decode_text(LEGACY_DAT)
    assert encoding == WINDOWS_1252
    assert "Élise" in text and "Mañana" in text and "sweet–tart" in text
    assert "�" not in text


def test_windows_1252_table_matches_the_standard_codec():
    # Each lone byte >= 0x80 is invalid UTF-8, so it takes the fallback.
    undefined = {0x81, 0x8D, 0x8F, 0x90, 0x9D}
    for b in range(0x80, 0x100):
        text, encoding = decode_text(bytes([b]))
        assert encoding == WINDOWS_1252
        expected = chr(b) if b in undefined else bytes([b]).decode("cp1252")
        assert text == expected, hex(b)          # every byte kept: nothing lost


# ── Upload path and export ────────────────────────────────────────────────────

def test_windows_1252_upload_keeps_names_and_links(monkeypatch):
    monkeypatch.setattr(api, "_engine", api.get_engine())
    response = _upload(LEGACY_DAT, "pommes.dat")

    assert response["encoding"] == WINDOWS_1252
    assert response["files"] == [{"name": "pommes.dat", "encoding": WINDOWS_1252}]
    eng = api.get_engine()
    kid = eng.get("Kid")
    assert (kid.female_parent, kid.male_parent) == ("Élise", "Mañana")   # links resolve
    assert eng.get("Élise").traits == {"Taste": "sweet"}
    assert kid.traits == {"Taste": "sweet–tart"}


def test_export_of_a_windows_1252_file_is_utf8(monkeypatch):
    monkeypatch.setattr(api, "_engine", api.get_engine())
    _upload(LEGACY_DAT, "pommes.dat")

    response = api.export_dat()
    assert "charset=utf-8" in response.headers["content-type"]
    body = response.body
    assert "Élise".encode("utf-8") in body and "sweet–tart".encode("utf-8") in body
    assert body.decode("utf-8")                      # valid UTF-8 throughout

    # Read back as UTF-8, the same pedigree comes out.
    text, encoding = decode_text(body)
    assert encoding == UTF8
    assert (PmpParser.from_dat_text(text).engine.to_dict()
            == api.get_engine().to_dict())


def test_utf8_upload_reports_utf8(monkeypatch):
    monkeypatch.setattr(api, "_engine", api.get_engine())
    utf8 = DatExporter.to_dat_text(PmpParser.from_dat_text(decode_text(LEGACY_DAT)[0]).engine)
    response = _upload(utf8.encode("utf-8"), "pommes-utf8.dat")
    assert response["encoding"] == UTF8
    assert api.get_engine().get("Kid").female_parent == "Élise"
