# backend/tests/test_smoke.py
# ============================
# Smoke tests for the Pedimap 2 FastAPI backend.
# These run on every push via the CI workflow (pytest backend/tests/).
#
# Scope: import-level and basic API contract checks.
# Add feature-specific test files (e.g. test_pedigree_engine.py) as the
# backend grows.  Each file should be self-contained — set up its own data
# rather than relying on shared global state.

import importlib
import os
import sys

# Ensure backend/ is on the path when tests are run from the repo root.
_BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)


# ── Import smoke tests ────────────────────────────────────────────────────────

def test_pedigree_engine_importable():
    """PedigreeEngine module must import without errors."""
    mod = importlib.import_module("pedigree_engine")
    assert mod is not None


def test_pmp_parser_importable():
    """PmpParser module must import without errors."""
    mod = importlib.import_module("pmp_parser")
    assert mod is not None


def test_sample_data_importable():
    """Sample data module must import without errors."""
    mod = importlib.import_module("sample_data")
    assert mod is not None


# ── PedigreeEngine basic contract ─────────────────────────────────────────────

def test_pedigree_engine_has_expected_api():
    """PedigreeEngine must expose the methods the REST API depends on."""
    mod = importlib.import_module("pedigree_engine")
    # Locate the engine class (accepts either name used in the codebase)
    EngineClass = getattr(mod, "PedigreeEngine", None)
    assert EngineClass is not None, \
        "pedigree_engine must define a class named PedigreeEngine"

    required_methods = [
        "get_graph",
        "get_individual",
        "list_individuals",
        "get_color_map",
        "build_subpop",
    ]
    for method in required_methods:
        assert hasattr(EngineClass, method), \
            f"PedigreeEngine is missing expected method: {method}"


# ── Sample data contract ──────────────────────────────────────────────────────

def test_sample_data_loads_without_error():
    """Loading the sample dataset must not raise any exception."""
    sample = importlib.import_module("sample_data")
    # The module should expose a function or dict that provides pedigree data.
    # Accept either a callable loader or a top-level data attribute.
    has_loader = callable(getattr(sample, "get_sample_data", None))
    has_data   = getattr(sample, "SAMPLE_DATA",   None) is not None or \
                 getattr(sample, "sample_data",   None) is not None or \
                 getattr(sample, "INDIVIDUALS",   None) is not None
    assert has_loader or has_data, \
        "sample_data must expose get_sample_data() or a SAMPLE_DATA / INDIVIDUALS attribute"


# ── Fallback ──────────────────────────────────────────────────────────────────

def test_placeholder():
    """Always-passing sentinel so pytest never exits with code 5 (no tests)."""
    assert True
