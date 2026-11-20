"""
A synthetic pedigree with IBD data, for performance measurements of the
haplotype display (docs/design/haplotype-display.md, §8): by default 300
individuals (30 founders, then six generations of 45), one linkage group with
50 IBD positions (one per marker, 2 cM apart).

Offspring inherit each homologue from one parent (the first homologue from
the first parent), copying that parent's two homologues with crossovers
between positions; the probabilities blur the true founder allele with the
parent's other one, in two decimals that sum to exactly 1. Founders have
probability 1 on their own
founder alleles, as the files of FlexQTL and Binko do.

    cd backend && python -m tests.synthetic_ibd > /tmp/synthetic.dat
"""
import random
import sys
from typing import List

CM_STEP = 2.0
RECOMBINATION = 0.02            # per 2 cM interval


def _probabilities(true_allele: int, other: int, nalleles: int, rng: random.Random) -> List[str]:
    """Two-decimal probabilities, most on the true founder allele."""
    vec = [0.0] * nalleles
    certain = rng.random() < 0.7 or other == true_allele
    share = 1.0 if certain else round(rng.uniform(0.55, 0.95), 2)
    vec[true_allele - 1] += share
    if not certain:
        vec[other - 1] += round(1.0 - share, 2)
    return ["0" if v == 0 else f"{v:.2f}" for v in vec]


def synthetic_ibd_dat(individuals: int = 300, founders: int = 30, positions: int = 50,
                      seed: int = 20261120) -> str:
    rng = random.Random(seed)
    nalleles = 2 * founders
    names = [f"F{i + 1:03d}" for i in range(founders)]
    parents = {n: (None, None) for n in names}
    # haplotypes[name][h][k]: the true founder allele of homologue h at position k
    haplotypes = {n: [[2 * i + 1] * positions, [2 * i + 2] * positions] for i, n in enumerate(names)}
    # The others in generations of equal size, each child's parents from the
    # generation before (and now and then one from two generations back).
    generations = [list(names)]
    per_generation = 45
    while len(names) < individuals:
        g = len(generations)
        current: List[str] = []
        for _ in range(min(per_generation, individuals - len(names))):
            pool = generations[-1] + (generations[-2] if g > 1 and rng.random() < 0.2 else [])
            p1, p2 = rng.sample(pool, 2)
            child = f"G{g}_{len(current) + 1:03d}"
            homologues = []
            for parent in (p1, p2):
                strand = rng.randrange(2)
                path = []
                for k in range(positions):
                    if k and rng.random() < RECOMBINATION:
                        strand = 1 - strand
                    path.append(haplotypes[parent][strand][k])
                homologues.append(path)
            haplotypes[child] = homologues
            parents[child] = (p1, p2)
            current.append(child)
            names.append(child)
        generations.append(current)

    markers = [f"S{k + 1:03d}" for k in range(positions)]
    lines = [
        "; Synthetic pedigree with IBD data (backend/tests/synthetic_ibd.py); not real data.",
        "POPULATION = synthetic_ibd", "UNKNOWN    = -", "NALLELES   = %d" % nalleles,
        "PLOIDY     = 2", "", "PEDIGREE", "NAME  PARENT1  PARENT2",
    ]
    lines += [f"{n}  {parents[n][0] or '-'}  {parents[n][1] or '-'}" for n in names]
    lines += ["", "LINKAGEGROUP 1", "", "MAP"]
    lines += [f"{m}  {k * CM_STEP:.1f}" for k, m in enumerate(markers)]
    lines += ["", "IBDPOSITIONS " + " ".join(f"{k * CM_STEP:.1f}" for k in range(positions))]
    for k in range(positions):
        lines += ["", f"IBDPOSITION {k * CM_STEP:.1f} ; LG 1"]
        for n in names:
            p = parents[n]
            row = []
            for h in range(2):
                true_allele = haplotypes[n][h][k]
                other = haplotypes[p[h]][1 - (haplotypes[p[h]][0][k] == true_allele)][k] if p[h] else true_allele
                row += _probabilities(true_allele, other, nalleles, rng)
            lines.append(f"{n}  " + " ".join(row))
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    sys.stdout.write(synthetic_ibd_dat())
