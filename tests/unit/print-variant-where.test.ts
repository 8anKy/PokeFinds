import { describe, it, expect } from "vitest";
import { NOT_REVERSE_PRINTING, REVERSE_VARIANT_LABELS } from "@/lib/print-variant";

/**
 * `NOT variantLabel IN (…)` släppte bort det ETIKETTLÖSA ordinarie kortet (NULL) —
 * graderingens "Ograderat"-värde var "–" i två månader. Villkoret måste nämna NULL.
 */
describe("NOT_REVERSE_PRINTING", () => {
  it("tar med det etikettlösa ordinarie kortet uttryckligen", () => {
    expect(NOT_REVERSE_PRINTING.OR).toContainEqual({ variantLabel: null });
  });
  it("utesluter hela reverse-familjen", () => {
    expect(NOT_REVERSE_PRINTING.OR).toContainEqual({ variantLabel: { notIn: [...REVERSE_VARIANT_LABELS] } });
  });
});
