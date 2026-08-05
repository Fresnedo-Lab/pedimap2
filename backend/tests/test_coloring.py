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
