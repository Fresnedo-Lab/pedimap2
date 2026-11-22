import { describe, expect, it } from "vitest";
import { apiErrorMessage } from "./useApi";

describe("API error messages", () => {
  it("are the server's plain message, never the raw reply", () => {
    expect(apiErrorMessage(404, JSON.stringify({ detail: "Linkage group '1' has no IBD positions." })))
      .toBe("Linkage group '1' has no IBD positions.");
    expect(apiErrorMessage(400, JSON.stringify({ detail: "Parse error: Line 12: an ALLELES row …" })))
      .toBe("Parse error: Line 12: an ALLELES row …");
    expect(apiErrorMessage(404, "not found")).toBe("not found");
    for (const raw of ["<html><body>Internal Server Error</body></html>", JSON.stringify({ detail: [{ loc: [] }] }), ""]) {
      expect(apiErrorMessage(500, raw)).toBe("The Pedimap service could not complete the request (error 500).");
    }
  });
});
