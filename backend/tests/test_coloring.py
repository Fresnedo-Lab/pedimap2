"""
Tests for discrete-trait color resolution (semantic names + palette + override).
"""
from pedigree_engine import (
    CrossType, Individual, PedigreeEngine, TraitMeta, TraitType,
)


def _engine_with(categories, value_colors=None):
    eng = PedigreeEngine()
    eng.traits.append(TraitMeta(
        name="Color", trait_type=TraitType.QUALITATIVE, categories=list(categories),
        value_colors=value_colors or {},
    ))
    for i, cat in enumerate(categories):
        ind = Individual(id=f"i{i}", name=f"i{i}", cross_type=CrossType.UNKNOWN,
                         traits={"Color": cat})
        eng._individuals[ind.id] = ind
        eng.graph.add_node(ind.id, data=ind)
    return eng


def test_semantic_color_names_resolve():
    eng = _engine_with(["Green", "Red", "Yellow"])
    assert eng.trait_color("i0", "Color") == "#22C55E"  # Green
    assert eng.trait_color("i1", "Color") == "#EF4444"  # Red
    assert eng.trait_color("i2", "Color") == "#EAB308"  # Yellow


def test_color_names_are_case_insensitive():
    eng = _engine_with(["RED", "blue", "Grey", "gray"])
    assert eng.trait_color("i0", "Color") == "#EF4444"
    assert eng.trait_color("i1", "Color") == "#3B82F6"
    # grey and gray map to the same hex
    assert eng.trait_color("i2", "Color") == eng.trait_color("i3", "Color") == "#6B7280"


def test_mixed_trait_resolves_per_value_without_collision():
    # "Red" is semantic; "Tart"/"Sweet" are not — they get palette colors that
    # must not collide with the resolved red.
    eng = _engine_with(["Red", "Tart", "Sweet"])
    red = eng.trait_color("i0", "Color")
    tart = eng.trait_color("i1", "Color")
    sweet = eng.trait_color("i2", "Color")
    assert red == "#EF4444"
    assert tart != red and sweet != red
    assert tart != sweet


def test_non_color_values_use_palette():
    eng = _engine_with(["Small", "Medium", "Large"])
    colors = {eng.trait_color(f"i{i}", "Color") for i in range(3)}
    assert len(colors) == 3  # three distinct palette entries


def test_value_color_override_wins():
    # Override must beat the semantic name (Pedimap 1.x reassignment).
    eng = _engine_with(["Red", "Green"], value_colors={"Red": "#123456"})
    assert eng.trait_color("i0", "Color") == "#123456"
    assert eng.trait_color("i1", "Color") == "#22C55E"  # Green still semantic


# ── Continuous-trait color overrides (low / high / missing) ──────────────────

def _continuous_engine():
    eng = PedigreeEngine()
    eng.traits.append(TraitMeta(name="Size", trait_type=TraitType.CONTINUOUS,
                                min_val=0.0, max_val=10.0,
                                color_low="#000000", color_high="#FFFFFF"))
    for iid, val in [("lo", 0.0), ("mid", 5.0), ("hi", 10.0), ("none", None)]:
        traits = {} if val is None else {"Size": val}
        ind = Individual(id=iid, name=iid, cross_type=CrossType.UNKNOWN, traits=traits)
        eng._individuals[iid] = ind
        eng.graph.add_node(iid, data=ind)
    return eng


def test_continuous_defaults_use_trait_gradient():
    eng = _continuous_engine()
    assert eng.trait_color("lo", "Size") == "#000000"
    assert eng.trait_color("hi", "Size") == "#ffffff"
    assert eng.trait_color("none", "Size") == "#6B7280"


def test_continuous_overrides_replace_gradient_and_missing():
    eng = _continuous_engine()
    kw = dict(low="#FF0000", high="#0000FF", missing="#00FF00")
    assert eng.trait_color("lo", "Size", **kw).lower() == "#ff0000"
    assert eng.trait_color("hi", "Size", **kw).lower() == "#0000ff"
    assert eng.trait_color("mid", "Size", **kw).lower() == "#7f007f"
    assert eng.trait_color("none", "Size", **kw) == "#00FF00"


def test_color_endpoint_accepts_and_validates_overrides(monkeypatch):
    import pytest
    from fastapi import HTTPException
    import api
    monkeypatch.setattr(api, "_engine", _continuous_engine())
    colors = api.color_by_trait("Size", low="#FF0000", high="#0000FF", missing="#00FF00")
    assert colors["lo"].lower() == "#ff0000" and colors["none"] == "#00FF00"
    assert api.color_by_trait("Size")["none"] == "#6B7280"
    for bad in ({"low": "red"}, {"high": "#12345"}, {"missing": "#GGGGGG"}):
        with pytest.raises(HTTPException) as exc:
            api.color_by_trait("Size", **bad)
        assert exc.value.status_code == 400
