"""
sample_data.py  –  Demo apple breeding pedigree (36 individuals, 4 generations)
"""
from pedigree_engine import PedigreeEngine, Individual, TraitMeta, MarkerMeta, CrossType, TraitType


def load_sample_data() -> PedigreeEngine:
    eng = PedigreeEngine()
    eng.population_name = "Apple Breeding Programme – Demo"
    eng.ploidy = 2

    eng.traits = [
        TraitMeta("Scab Resistance",   TraitType.CONTINUOUS,   0, 9,  [], "#3B82F6", "#10B981"),
        TraitMeta("Mildew Resistance", TraitType.CONTINUOUS,   0, 9,  [], "#3B82F6", "#10B981"),
        TraitMeta("Fruit Firmness",    TraitType.CONTINUOUS,   0, 10, [], "#F59E0B", "#EF4444"),
        TraitMeta("Yield Class",       TraitType.QUALITATIVE,  0, 0,
                  ["low", "medium", "high", "very high"]),
    ]
    eng.markers = [
        MarkerMeta("CH-Vf1", "LG1", 45.2), MarkerMeta("CH-Vf2", "LG1", 52.8),
        MarkerMeta("Hi02c07", "LG2", 18.4), MarkerMeta("Hi07a04", "LG2", 31.6),
        MarkerMeta("CH02b10", "LG3", 60.1),
    ]

    inds = [
        # Generation 0 – founders
        Individual("F01","Golden Delicious",  None,  None, CrossType.UNKNOWN, 2, 0,
                   {"Scab Resistance":3,"Mildew Resistance":4,"Fruit Firmness":8,"Yield Class":"high"},
                   {"CH-Vf1":["a","b"],"CH-Vf2":["c","c"]}),
        Individual("F02","Cox's Orange Pippin",None,None,CrossType.UNKNOWN,2,0,
                   {"Scab Resistance":2,"Mildew Resistance":3,"Fruit Firmness":7,"Yield Class":"medium"},
                   {"CH-Vf1":["a","c"],"CH-Vf2":["b","d"]}),
        Individual("F03","Florina",            None,  None, CrossType.UNKNOWN, 2, 0,
                   {"Scab Resistance":8,"Mildew Resistance":7,"Fruit Firmness":6,"Yield Class":"high"},
                   {"CH-Vf1":["b","d"],"CH-Vf2":["a","c"]}),
        Individual("F04","Jonagold",           None,  None, CrossType.UNKNOWN, 2, 0,
                   {"Scab Resistance":4,"Mildew Resistance":5,"Fruit Firmness":9,"Yield Class":"very high"},
                   {"CH-Vf1":["a","a"],"CH-Vf2":["b","b"]}),
        Individual("F05","Gala",               None,  None, CrossType.UNKNOWN, 2, 0,
                   {"Scab Resistance":3,"Mildew Resistance":4,"Fruit Firmness":7,"Yield Class":"high"},
                   {"CH-Vf1":["c","d"],"CH-Vf2":["a","b"]}),
        Individual("F06","Braeburn",           None,  None, CrossType.UNKNOWN, 2, 0,
                   {"Scab Resistance":5,"Mildew Resistance":6,"Fruit Firmness":8,"Yield Class":"high"},
                   {"CH-Vf1":["a","b"],"CH-Vf2":["c","d"]}),
        # Generation 1
        Individual("G1_01","WA-101","F01","F03",CrossType.CROSS,2,1,
                   {"Scab Resistance":6,"Mildew Resistance":6,"Fruit Firmness":7,"Yield Class":"high"},
                   {"CH-Vf1":["b","a"],"CH-Vf2":["a","c"]}),
        Individual("G1_02","WA-102","F02","F03",CrossType.CROSS,2,1,
                   {"Scab Resistance":5,"Mildew Resistance":5,"Fruit Firmness":7,"Yield Class":"medium"},
                   {"CH-Vf1":["a","b"],"CH-Vf2":["b","a"]}),
        Individual("G1_03","WA-103","F01","F04",CrossType.CROSS,2,1,
                   {"Scab Resistance":4,"Mildew Resistance":5,"Fruit Firmness":9,"Yield Class":"very high"},
                   {"CH-Vf1":["a","a"],"CH-Vf2":["c","b"]}),
        Individual("G1_04","WA-104","F04","F05",CrossType.CROSS,2,1,
                   {"Scab Resistance":4,"Mildew Resistance":5,"Fruit Firmness":8,"Yield Class":"high"},
                   {"CH-Vf1":["c","a"],"CH-Vf2":["b","b"]}),
        Individual("G1_05","WA-105","F05","F06",CrossType.CROSS,2,1,
                   {"Scab Resistance":4,"Mildew Resistance":5,"Fruit Firmness":8,"Yield Class":"high"},
                   {"CH-Vf1":["c","a"],"CH-Vf2":["a","d"]}),
        Individual("G1_06","WA-106","F03","F06",CrossType.CROSS,2,1,
                   {"Scab Resistance":7,"Mildew Resistance":7,"Fruit Firmness":7,"Yield Class":"high"},
                   {"CH-Vf1":["b","a"],"CH-Vf2":["c","c"]}),
        # Generation 2
        Individual("G2_01","SEL-201","G1_01","G1_02",CrossType.CROSS,2,2,
                   {"Scab Resistance":7,"Mildew Resistance":6,"Fruit Firmness":7,"Yield Class":"high"},{}),
        Individual("G2_02","SEL-202","G1_01","G1_03",CrossType.CROSS,2,2,
                   {"Scab Resistance":6,"Mildew Resistance":6,"Fruit Firmness":8,"Yield Class":"high"},{}),
        Individual("G2_03","SEL-203","G1_02","G1_04",CrossType.CROSS,2,2,
                   {"Scab Resistance":5,"Mildew Resistance":5,"Fruit Firmness":8,"Yield Class":"very high"},{}),
        Individual("G2_04","SEL-204","G1_03","G1_04",CrossType.CROSS,2,2,
                   {"Scab Resistance":5,"Mildew Resistance":5,"Fruit Firmness":9,"Yield Class":"very high"},{}),
        Individual("G2_05","SEL-205","G1_04","G1_05",CrossType.CROSS,2,2,
                   {"Scab Resistance":4,"Mildew Resistance":5,"Fruit Firmness":8,"Yield Class":"high"},{}),
        Individual("G2_06","SEL-206","G1_05","G1_06",CrossType.CROSS,2,2,
                   {"Scab Resistance":6,"Mildew Resistance":6,"Fruit Firmness":8,"Yield Class":"high"},{}),
        Individual("G2_07","SEL-207","G1_06","G1_01",CrossType.CROSS,2,2,
                   {"Scab Resistance":7,"Mildew Resistance":7,"Fruit Firmness":7,"Yield Class":"high"},{}),
        Individual("G2_08","SEL-208","G1_02","G1_06",CrossType.CROSS,2,2,
                   {"Scab Resistance":6,"Mildew Resistance":6,"Fruit Firmness":7,"Yield Class":"medium"},{}),
        # Generation 3
        Individual("G3_01","PROM-301","G2_01","G2_03",CrossType.CROSS,2,3,
                   {"Scab Resistance":7,"Mildew Resistance":6,"Fruit Firmness":8,"Yield Class":"high"},{}),
        Individual("G3_02","PROM-302","G2_02","G2_04",CrossType.CROSS,2,3,
                   {"Scab Resistance":6,"Mildew Resistance":6,"Fruit Firmness":9,"Yield Class":"very high"},{}),
        Individual("G3_03","PROM-303","G2_01","G2_07",CrossType.CROSS,2,3,
                   {"Scab Resistance":8,"Mildew Resistance":7,"Fruit Firmness":7,"Yield Class":"high"},{}),
        Individual("G3_04","PROM-304","G2_06","G2_03",CrossType.CROSS,2,3,
                   {"Scab Resistance":6,"Mildew Resistance":6,"Fruit Firmness":8,"Yield Class":"high"},{}),
        Individual("G3_05","ELITE-A","G2_07","G2_02",CrossType.CROSS,2,3,
                   {"Scab Resistance":8,"Mildew Resistance":8,"Fruit Firmness":8,"Yield Class":"very high"},{}),
        Individual("G3_06","ELITE-B","G2_04","G2_06",CrossType.CROSS,2,3,
                   {"Scab Resistance":7,"Mildew Resistance":7,"Fruit Firmness":9,"Yield Class":"very high"},{}),
    ]
    for ind in inds:
        eng.add_individual(ind)

    eng.assign_generations()
    return eng
