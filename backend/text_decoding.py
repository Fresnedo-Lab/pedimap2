"""
text_decoding.py  –  Pedimap 2
===============================
Decode text files that may come from Pedimap 1.x, a Windows program whose
files are often in the legacy Windows-1252 encoding rather than UTF-8.

    decode_text(data) -> (text, encoding)

1. A UTF-8 byte-order mark is stripped.
2. Strict UTF-8 is tried first.
3. Otherwise the bytes are decoded as Windows-1252. Every byte maps to a
   character (the five bytes Windows-1252 leaves undefined keep their own
   code point, as browsers do), so nothing is replaced or lost.

The desktop shell's read_file command (src-tauri/src/main.rs) implements the
same rules; keep them in step. Exports are always written as UTF-8.
"""
from typing import Tuple

UTF8 = "utf-8"
WINDOWS_1252 = "windows-1252"

_UTF8_BOM = b"\xef\xbb\xbf"

# Windows-1252 differs from Latin-1 only in 0x80-0x9F. Undefined bytes
# (0x81, 0x8D, 0x8F, 0x90, 0x9D) are absent here and keep their code point.
_CP1252_80_9F = {
    0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„",
    0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ",
    0x89: "‰", 0x8A: "Š", 0x8B: "‹", 0x8C: "Œ",
    0x8E: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“",
    0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
    0x98: "˜", 0x99: "™", 0x9A: "š", 0x9B: "›",
    0x9C: "œ", 0x9E: "ž", 0x9F: "Ÿ",
}
_LATIN1_TO_CP1252 = str.maketrans({chr(b): c for b, c in _CP1252_80_9F.items()})


def decode_text(data: bytes) -> Tuple[str, str]:
    """Return (text, encoding) where encoding is UTF8 or WINDOWS_1252."""
    if data.startswith(_UTF8_BOM):
        data = data[len(_UTF8_BOM):]
    try:
        return data.decode("utf-8"), UTF8
    except UnicodeDecodeError:
        # latin-1 maps each byte to the same code point; then fix 0x80-0x9F.
        return data.decode("latin-1").translate(_LATIN1_TO_CP1252), WINDOWS_1252
