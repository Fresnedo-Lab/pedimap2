# backend/tests/test_smoke.py
# ============================
# Smoke tests for the Pedimap 2 FastAPI backend.
# All assertions are derived from the actual source code in backend/.
#
# Module layout:
#   pedigree_engine.py  — PedigreeEngine class + dataclasses
#   sample_data.py      — load_sample_data() → PedigreeEngine
#   pmp_parser.py       — optional; may be absent (skipped if not found)
#   api.py              — FastAPI app; REST endpoints wrap PedigreeEngine

import importlib
import os
import sys

import pytest

# Ensure backend/ is on the path when pytest runs from the repo root.
_BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)


# ── 1. Import smoke tests ─────────────────────────────────────────────────────

def test_pedigree_engine_importable():
    """pedigree_engine module must import without errors."""
    mod = importlib.import_module("pedigree_engine")
    assert mod is not None


def test_sample_data_importable():
    """sample_data module must import without errors."""
    mod = importlib.import_module("sample_data")
    assert mod is not None


def test_pmp_parser_importable():
    """pmp_parser is an optional module; skip gracefully if absent."""
    pytest.importorskip(
        "pmp_parser",
        reason="pmp_parser is optional and not present in this build",
    )


# ── 2. PedigreeEngine class contract ─────────────────────────────────────────

def test_pedigree_engine_class_exists():
    """pedigree_engine must define a class named PedigreeEngine."""
    mod = importlib.import_module("pedigree_engine")
    assert hasattr(mod, "PedigreeEngine"), \
        "pedigree_engine must define PedigreeEngine"


def test_pedigree_engine_has_expected_methods():
    """PedigreeEngine must expose the methods used by the REST API layer."""
    mod = importlib.import_module("pedigree_engine")
    EngineClass = mod.PedigreeEngine

    # Methods confirmed present in pedigree_engine.py source:
    required = [
        "add_individual",    # add a new Individual to the DAG
        "get",               # look up an Individual by id
        "all_ids",           # list all individual ids
        "count",             # number of individuals
        "ancestors",         # NetworkX ancestors query
        "descendants",       # NetworkX descendants query
        "siblings",          # shared-parent query
        "founders",          # nodes with in-degree 0
        "leaves",            # nodes with out-degree 0
        "assign_generations",# longest-path generation assignment
        "to_dict",           # serialize to JSON-compatible dict
        "from_dict",         # classmethod: deserialize from dict
    ]
    missing = [m for m in required if not hasattr(EngineClass, m)]
    assert not missing, \
        f"PedigreeEngine is missing expected methods: {missing}"


def test_pedigree_engine_instantiates():
    """PedigreeEngine() must construct without arguments."""
    mod = importlib.import_module("pedigree_engine")
    eng = mod.PedigreeEngine()
    assert eng.count() == 0
    assert eng.all_ids() == []


def test_pedigree_engine_add_and_get():
    """add_individual + get round-trip must work correctly."""
    mod = importlib.import_module("pedigree_engine")
    Individual = mod.Individual
    eng = mod.PedigreeEngine()

    ind = Individual(id="TEST01", name="Test Individual")
    eng.add_individual(ind)

    assert eng.count() == 1
    retrieved = eng.get("TEST01")
    assert retrieved is not None
    assert retrieved.name == "Test Individual"


def test_pedigree_engine_founders_and_leaves():
    """A single individual with no parents is both a founder and a leaf."""
    mod = importlib.import_module("pedigree_engine")
    Individual = mod.Individual
    eng = mod.PedigreeEngine()
    eng.add_individual(Individual(id="F1", name="Founder"))

    assert "F1" in eng.founders()
    assert "F1" in eng.leaves()


def test_pedigree_engine_to_dict_round_trip():
    """to_dict / from_dict must preserve individual data."""
    mod = importlib.import_module("pedigree_engine")
    Individual = mod.Individual
    eng = mod.PedigreeEngine()
    eng.population_name = "Test Pop"
    eng.add_individual(Individual(id="A1", name="Alpha"))

    data = eng.to_dict()
    restored = mod.PedigreeEngine.from_dict(data)

    assert restored.population_name == "Test Pop"
    assert restored.count() == 1
    assert restored.get("A1") is not None
    assert restored.get("A1").name == "Alpha"


# ── 3. sample_data contract ───────────────────────────────────────────────────

def test_sample_data_has_loader():
    """sample_data must expose load_sample_data()."""
    mod = importlib.import_module("sample_data")
    assert callable(getattr(mod, "load_sample_data", None)), \
        "sample_data must define load_sample_data()"


def test_sample_data_loads_successfully():
    """load_sample_data() must return a non-empty PedigreeEngine."""
    sample = importlib.import_module("sample_data")
    eng = sample.load_sample_data()

    mod = importlib.import_module("pedigree_engine")
    assert isinstance(eng, mod.PedigreeEngine)
    assert eng.count() > 0, "Sample dataset must contain at least one individual"
    assert eng.population_name, "Sample dataset must have a population name"


# ── 4. Sentinel ───────────────────────────────────────────────────────────────

def test_placeholder():
    """Always-passing sentinel so pytest never exits with code 5."""
    assert True
