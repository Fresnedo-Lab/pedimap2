"""
api.py  –  Pedimap 2.0  FastAPI Backend
=========================================
Sidecar process spawned by the Tauri shell.
Listens on 127.0.0.1:5173.
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

# ── Application ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="Pedimap 2.0 API",
    description="REST backend for the Pedimap 2.0 desktop application",
    version="2.0.0",
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
    return {"status": "ok", "version": "2.0.0"}


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
        "ancestors":     len(eng.ancestors(ind_id)),
        "descendants":   len(eng.descendants(ind_id)),
        "siblings":      len(eng.siblings(ind_id)),
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
            "id":         ind.id,
            "label":      ind.name,
            "x":          p["x"],
            "y":          p["y"],
            "generation": ind.generation,
            "cross_type": ind.cross_type.value,
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
            "id":         ind_id,
            "label":      ind.name if ind else ind_id,
            "x":          p["x"],
            "y":          p["y"],
            "generation": eng.generation_of(ind_id),
            "is_focal":   ind_id == req.focal_id,
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


@app.get("/api/export/json")
def export_json():
    return JSONResponse(_engine.to_dict())


@app.get("/api/export/dat")
def export_dat():
    try:
        from pmp_parser import DatExporter
        return PlainTextResponse(DatExporter.to_dat_text(_engine),
                                 media_type="text/plain")
    except ImportError:
        raise HTTPException(501, "DatExporter not available.")


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
    port = int(os.environ.get("PEDIMAP_PORT", 5173))
    uvicorn.run("api:app", host="127.0.0.1", port=port, log_level="warning")
