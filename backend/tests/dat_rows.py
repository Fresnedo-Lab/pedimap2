"""
Helpers for tests that compare parser/exporter output with the rows of a
source .dat file. Used by the private-fixture tests, which must derive every
expectation from the file at run time rather than hard-code its contents.
"""
from typing import List

_SECTION_KEYWORDS = {"LINKAGEGROUP", "MAP", "LOCUS", "ALLELES", "IBDPOSITION"}


def pedigree_rows(dat_text: str) -> List[List[str]]:
    """Whitespace tokens of each PEDIGREE data row (no quoted names assumed)."""
    lines = dat_text.splitlines()
    start = next(i for i, line in enumerate(lines) if line.split()[:1] == ["NAME"])
    rows = []
    for line in lines[start + 1:]:
        toks = line.split(";")[0].split()
        if not toks:
            continue
        if toks[0].upper() in _SECTION_KEYWORDS:
            break
        rows.append(toks)
    return rows
