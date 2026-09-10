import { describe, expect, it } from "vitest";
import { collectionImportPublic } from "@/lib/collection-import-gate";

describe("collectionImportPublic", () => {
  it("är dold när spaken saknas eller har ett annat värde", () => {
    expect(collectionImportPublic(undefined)).toBe(false);
    expect(collectionImportPublic("")).toBe(false);
    expect(collectionImportPublic("true")).toBe(false);
    expect(collectionImportPublic("0")).toBe(false);
  });

  it("öppnas bara av det uttryckliga värdet 1", () => {
    expect(collectionImportPublic("1")).toBe(true);
  });
});
