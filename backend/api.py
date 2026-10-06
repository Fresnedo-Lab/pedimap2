"""
api.py  –  Pedimap 2.0  FastAPI Backend
=========================================
Sidecar process spawned by the Tauri shell.
Listens on 127.0.0.1:8765.
"""
import json
import os
import sys
import tempfile
from typing import Any, Dict, List, Optional

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel

from pedigree_engine import CrossType, Individual, PedigreeEngine, TraitType
from sample_data import load_sample_data

# ── Determine if running as PyInstaller bundle ────────────────────────────────
IS_FROZEN = getattr(sys, "frozen", False)
BASE_DIR  = sys._MEIPASS if IS_FROZEN else os.path.dirname(os.path.abspath(__file__))


def resource_path(relative: str) -> str:
    """Resolve a path to a bundled resource.

    Works both in development (relative to this file) and inside a PyInstaller
    bundle (relative to the extracted _MEIPASS directory). Use this anywhere a
    bundled file — demo data, static assets — needs to be located at runtime.
    """
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, relative)


# ── Runtime configuration ─────────────────────────────────────────────────────
# Resolved once at import time so the /api/health endpoint and the __main__
# entry point report the same port.
PORT = int(os.environ.get("PEDIMAP_PORT", 8765))


def _resolve_version() -> str:
    """Read the app version from package.json — the single source of truth.

    The backend must NOT carry its own version literal that could drift from
    package.json / Cargo.toml / tauri.conf.json. Reads the bundled copy inside
    the frozen sidecar (resource_path) and the repo-root file in development.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    for path in (resource_path("package.json"),          # frozen bundle
                 os.path.join(here, "..", "package.json")):  # dev (repo root)
        try:
            with open(path, encoding="utf-8") as fh:
                version = json.load(fh).get("version")
            if version:
                return version
        except (OSError, ValueError):
            continue
    return "0.0.0"  # last resort; indicates the version file was not found


__version__ = _resolve_version()

# ── Application ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="Pedimap 2.0 API",
    description="REST backend for the Pedimap 2.0 desktop application",
    version=__version__,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Tauri webview origin varies by platform
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Global engine state ───────────────────────────────────────────────────────
_engine: PedigreeEngine = load_sample_data()


def get_engine() -> PedigreeEngine:
    return _engine


# ── Pydantic models ───────────────────────────────────────────────────────────

class IndividualIn(BaseModel):
    id: str
    name: str
    female_parent: Optional[str] = None
    male_parent:   Optional[str] = None
    cross_type:    str           = "cross"
    ploidy:        int           = 2
    traits:        Dict[str, Any] = {}
    markers:       Dict[str, List[str]] = {}
    notes:         str           = ""


class SubpopRequest(BaseModel):
    focal_id:     str
    ancestors:    bool = True
    descendants:  bool = True
    siblings:     bool = False
    maternal_only: bool = False


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok", "version": app.version, "port": PORT}


@app.get("/api/pedigree")
def get_pedigree():
    return _engine.to_dict()


@app.get("/api/individuals")
def list_individuals():
    eng = get_engine()
    eng.assign_generations()
    return [
        {
            "id":         ind.id,
            "name":       ind.name,
            "generation": ind.generation,
            "cross_type": ind.cross_type.value,
        }
        for ind in eng._individuals.values()
    ]


def _relatives(eng: PedigreeEngine, ids) -> List[Dict[str, str]]:
    """Relatives as {id, name} in pedigree order (parents before children)."""
    return [{"id": i, "name": eng.get(i).name} for i in eng.in_order(ids)]


@app.get("/api/individual/{ind_id}")
def get_individual(ind_id: str):
    eng = get_engine()
    ind = eng.get(ind_id)
    if not ind:
        raise HTTPException(404, f"Individual '{ind_id}' not found.")
    return {
        "id":            ind.id,
        "name":          ind.name,
        "female_parent": ind.female_parent,
        "male_parent":   ind.male_parent,
        "cross_type":    ind.cross_type.value,
        "ploidy":        ind.ploidy,
        "generation":    ind.generation,
        "traits":        ind.traits,
        "markers":       ind.markers,
        "notes":         ind.notes,
        "ancestors":     _relatives(eng, eng.ancestors(ind_id)),
        "descendants":   _relatives(eng, eng.descendants(ind_id)),
        "siblings":      _relatives(eng, eng.siblings(ind_id)),
    }


@app.get("/api/layout")
def get_layout():
    return get_engine().layout()


@app.get("/api/graph")
def get_graph():
    eng = get_engine()
    pos = eng.layout()
    nodes = []
    for ind_id, ind in eng._individuals.items():
        p = pos.get(ind_id, {"x": 0, "y": 0})
        nodes.append({
            "id":            ind.id,
            "label":         ind.name,
            "x":             p["x"],
            "y":             p["y"],
            "generation":    ind.generation,
            "cross_type":    ind.cross_type.value,
            # Included so the frontend can build node hover tooltips without a
            # second round-trip. Parents are None for founders/unknown parents.
            "female_parent": ind.female_parent,
            "male_parent":   ind.male_parent,
            "traits":        ind.traits,
        })
    edges = [
        {"from": u, "to": v, "role": d.get("role", "unknown")}
        for u, v, d in eng.graph.edges(data=True)
    ]
    return {"nodes": nodes, "edges": edges}


@app.get("/api/color/{trait_name}")
def color_by_trait(trait_name: str):
    eng = get_engine()
    return {
        ind_id: eng.trait_color(ind_id, trait_name)
        for ind_id in eng.all_ids()
    }


@app.post("/api/subpop")
def build_subpop(req: SubpopRequest):
    eng = get_engine()
    ids: set = {req.focal_id}
    if req.ancestors:
        ids |= set(eng.ancestors(req.focal_id))
    if req.descendants:
        ids |= set(eng.descendants(req.focal_id))
    if req.siblings:
        ids |= set(eng.siblings(req.focal_id))
    pos = eng.layout()
    nodes, edges = [], []
    for ind_id in ids:
        ind = eng.get(ind_id)
        p   = pos.get(ind_id, {"x": 0, "y": 0})
        nodes.append({
            "id":            ind_id,
            "label":         ind.name if ind else ind_id,
            "x":             p["x"],
            "y":             p["y"],
            "generation":    eng.generation_of(ind_id),
            "cross_type":    ind.cross_type.value if ind else "unknown",
            "female_parent": ind.female_parent if ind else None,
            "male_parent":   ind.male_parent if ind else None,
            "traits":        ind.traits if ind else {},
            "is_focal":      ind_id == req.focal_id,
        })
    for u, v, d in eng.graph.edges(data=True):
        if u in ids and v in ids:
            edges.append({"from": u, "to": v, "role": d.get("role", "unknown")})
    return {"nodes": nodes, "edges": edges, "focal_id": req.focal_id}


@app.get("/api/stats")
def get_stats():
    eng = get_engine()
    return {
        "total":       eng.count(),
        "founders":    len(eng.founders()),
        "leaves":      len(eng.leaves()),
        "traits":      len(eng.traits),
        "markers":     len(eng.markers),
        "population":  eng.population_name,
        "ploidy":      eng.ploidy,
    }


@app.post("/api/load")
async def load_file(
    dat_file: UploadFile = File(...),
    pmp_file: Optional[UploadFile] = File(None),
):
    """
    Accept a .json, .dat, or .dat+.pmp upload and replace the engine state.
    """
    global _engine
    dat_text = (await dat_file.read()).decode("utf-8", errors="replace")
    fname = dat_file.filename or ""

    if fname.lower().endswith(".json"):
        data = json.loads(dat_text)
        _engine = PedigreeEngine.from_dict(data)
        return {"loaded": "json", "individuals": _engine.count()}

    # .dat / .pmp path — needs pmp_parser
    try:
        from pmp_parser import PmpParser
        if pmp_file:
            pmp_text = (await pmp_file.read()).decode("utf-8", errors="replace")
            result = PmpParser.from_pmp_text(pmp_text, dat_text)
        else:
            result = PmpParser.from_dat_text(dat_text)
        _engine = result.engine
        return {"loaded": "dat", "individuals": _engine.count()}
    except ImportError:
        raise HTTPException(501, "pmp_parser module not available in this build.")
    except Exception as exc:
        raise HTTPException(400, f"Parse error: {exc}")


# ── Demo data ─────────────────────────────────────────────────────────────────
# Bundled legacy Pedimap 1.x example datasets. resource_path() finds them both
# in development (backend/demo_data/) and inside the frozen sidecar bundle.
_DEMO_DIR = resource_path("demo_data")


def _demo_description(dat_path: str) -> str:
    """First ';' comment line of the .dat, used as a human-readable blurb."""
    try:
        with open(dat_path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                s = line.strip()
                if s.startswith(";"):
                    return s.lstrip(";").strip()
                if s:  # first real content line — no leading comment
                    break
    except OSError:
        pass
    return ""


@app.get("/api/demo/list")
def demo_list():
    """Available bundled demo datasets, each with a name and description."""
    datasets = []
    try:
        names = sorted(os.listdir(_DEMO_DIR))
    except OSError:
        names = []
    for fn in names:
        if fn.lower().endswith(".dat"):
            name = fn[:-4]
            desc = _demo_description(os.path.join(_DEMO_DIR, fn)) or f"{name} dataset"
            datasets.append({"name": name, "description": desc})
    return {"datasets": datasets}


@app.get("/api/demo/load/{name}")
def demo_load(name: str):
    """Parse a bundled demo dataset and make it the active pedigree.

    Returns the same acknowledgement shape as POST /api/load; the client then
    refetches /api/pedigree and /api/graph.
    """
    global _engine
    # Names are simple identifiers — reject anything that could traverse paths.
    if not name or not all(c.isalnum() or c in "-_" for c in name):
        raise HTTPException(400, f"Invalid demo dataset name: {name!r}")
    dat_path = os.path.join(_DEMO_DIR, name + ".dat")
    if not os.path.exists(dat_path):
        raise HTTPException(404, f"Demo dataset not found: {name!r}")
    try:
        from pmp_parser import PmpParser
    except ImportError:
        raise HTTPException(501, "pmp_parser module not available in this build.")

    dat_text = open(dat_path, encoding="utf-8", errors="replace").read()
    pmp_path = os.path.join(_DEMO_DIR, name + ".pmp")
    try:
        if os.path.exists(pmp_path):
            pmp_text = open(pmp_path, encoding="utf-8", errors="replace").read()
            result = PmpParser.from_pmp_text(pmp_text, dat_text)
        else:
            result = PmpParser.from_dat_text(dat_text)
    except Exception as exc:
        raise HTTPException(400, f"Parse error: {exc}")

    _engine = result.engine
    return {"loaded": name, "individuals": _engine.count()}


@app.get("/api/export/json")
def export_json():
    return JSONResponse(_engine.to_dict())


@app.get("/api/export/dat")
def export_dat():
    try:
        from pmp_parser import DatExporter, DatExportError
    except ImportError:
        raise HTTPException(501, "DatExporter not available.")
    try:
        text = DatExporter.to_dat_text(_engine)
    except DatExportError as exc:
        raise HTTPException(409, f"Cannot export as .dat: {exc}")
    return PlainTextResponse(text, media_type="text/plain")


@app.post("/api/individual")
def add_individual(body: IndividualIn):
    global _engine
    ind = Individual(
        id=body.id,
        name=body.name,
        female_parent=body.female_parent,
        male_parent=body.male_parent,
        cross_type=CrossType(body.cross_type),
        ploidy=body.ploidy,
        traits=body.traits,
        markers=body.markers,
        notes=body.notes,
    )
    try:
        _engine.add_individual(ind)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"added": ind.id}


@app.delete("/api/individual/{ind_id}")
def delete_individual(ind_id: str):
    global _engine
    if not _engine.get(ind_id):
        raise HTTPException(404, f"Individual '{ind_id}' not found.")
    _engine.remove_individual(ind_id)
    return {"deleted": ind_id}


@app.post("/api/reset")
def reset():
    global _engine
    _engine = load_sample_data()
    return {"reset": True, "individuals": _engine.count()}


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Required for PyInstaller bundles on macOS and Windows: without it, the
    # frozen executable re-spawns itself instead of starting child processes,
    # causing process-spawn recursion.
    import multiprocessing
    multiprocessing.freeze_support()

    # Pass the app object (not the "api:app" import string): uvicorn resolves an
    # import string by importing a module named "api" from the filesystem, which
    # does not exist inside a PyInstaller bundle. Passing the object also means
    # reload/workers are unavailable — correct for a bundled sidecar.
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
