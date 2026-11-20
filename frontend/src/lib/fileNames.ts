// lib/fileNames.ts
// ================
// Suggested names for exported files.

/** File extensions a population name may carry: FlexQTL and Binko write the
 *  data file's name as POPULATION ("sim_small_fq.dat"). */
const DATA_FILE_EXTENSION = /\.(dat|pmp|ped|json)$/i;

/** A name safe on every file system: anything but letters, digits, ".", "-"
 *  and "_" becomes "_". */
export function safeFileName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_");
}

/** The base of a suggested file name, without extension: the population name
 *  (less a data-file extension, so "pm_small.dat" gives "pm_small", not
 *  "pm_small.dat.png"), plus the focal individual of a subpopulation. */
export function exportBaseName(population: string | undefined, focalId?: string): string {
  const base = (population ?? "").trim().replace(DATA_FILE_EXTENSION, "") || "pedigree";
  return safeFileName(focalId ? `${base}_${focalId}_subpop` : base);
}
