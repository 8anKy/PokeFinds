import { describe, expect, it } from "vitest";
import { parseScanSearch } from "@/lib/scan-search-query";

describe("parseScanSearch — manuell sökning i skannern", () => {
  it("namn + nummer", () => {
    expect(parseScanSearch("Dark Tyranitar 19")).toEqual({ words: ["dark", "tyranitar"], number: "19" });
  });
  it("nummer med total, #-prefix och bokstavsnummer", () => {
    expect(parseScanSearch("charizard 4/102").number).toBe("4");
    expect(parseScanSearch("charizard #4").number).toBe("4");
    expect(parseScanSearch("falinks TG07").number).toBe("TG07");
  });
  it("bara namn", () => {
    expect(parseScanSearch("  pikachu  ")).toEqual({ words: ["pikachu"], number: null });
  });
  it("bara ETT nummer — ett andra sifferord stannar i orden", () => {
    expect(parseScanSearch("charizard 6 151")).toEqual({ words: ["charizard", "151"], number: "6" });
  });
  it("ord utan siffror blir aldrig ett nummer", () => {
    expect(parseScanSearch("ex GX").number).toBeNull();
  });
});
