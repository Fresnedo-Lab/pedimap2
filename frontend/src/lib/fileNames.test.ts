import { describe, expect, it } from "vitest";
import { exportBaseName } from "./fileNames";

describe("exportBaseName", () => {
  it("drops a data-file extension from the population name", () => {
    const base = exportBaseName("pm_small.dat");
    expect(["png", "svg", "pdf", "dat"].map(ext => `${base}.${ext}`))
      .toEqual(["pm_small.png", "pm_small.svg", "pm_small.pdf", "pm_small.dat"]);
    for (const ext of ["dat", "pmp", "ped", "json", "DAT"]) {
      expect(exportBaseName(`sim_small_fq.${ext}`)).toBe("sim_small_fq");
    }
  });

  it("keeps other names, names a subpopulation after its focal individual", () => {
    expect(exportBaseName("Apples")).toBe("Apples");
    expect(exportBaseName("v1.2 trial")).toBe("v1.2_trial");
    expect(exportBaseName("pm_small.dat", "G1_001")).toBe("pm_small_G1_001_subpop");
    expect(exportBaseName("")).toBe("pedigree");
    expect(exportBaseName(".dat")).toBe("pedigree");
  });
});
