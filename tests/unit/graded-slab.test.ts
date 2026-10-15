import { describe, expect, it } from "vitest";
import {
  COLLECTION_GRADING_ISSUERS,
  collectionGrading,
  gradeNumber,
  gradeWord,
  gradesForCollectionIssuer,
  gradingPayload,
  normalizeCollectionIssuer,
  parseCollectionGrade,
} from "@/lib/graded-slab";
import { traderaGradingIssuer } from "@/lib/tradera-listing-options";

describe("collectionGrading", () => {
  it("maps the collection's (Tradera) vocabulary to our issuer codes", () => {
    expect(collectionGrading("PSA", "10")).toEqual({ issuer: "PSA", gradeTenths: 100 });
    expect(collectionGrading("Beckett", "9.5")).toEqual({ issuer: "BGS", gradeTenths: 95 });
    expect(collectionGrading("Raukcard", "9")).toEqual({ issuer: "RAUKCARD", gradeTenths: 90 });
    expect(collectionGrading("sgc", "9,5")).toEqual({ issuer: "SGC", gradeTenths: 95 });
    expect(collectionGrading(" bgs ", "8")).toEqual({ issuer: "BGS", gradeTenths: 80 });
  });

  it("an unknown company is still a slab, but OTHER", () => {
    expect(collectionGrading("Övriga", "10")).toEqual({ issuer: "OTHER", gradeTenths: 100 });
    expect(normalizeCollectionIssuer("Kalles Grading")).toBe("OTHER");
  });

  it("company without grade (or grade without company) is not a grading", () => {
    expect(collectionGrading("PSA", null)).toBeNull();
    expect(collectionGrading("PSA", "")).toBeNull();
    expect(collectionGrading(null, "10")).toBeNull();
    expect(collectionGrading("", "10")).toBeNull();
  });

  it("only whole and half steps 1–10 are grades", () => {
    expect(parseCollectionGrade("10")).toBe(100);
    expect(parseCollectionGrade("1")).toBe(10);
    expect(parseCollectionGrade("9.7")).toBeNull();
    expect(parseCollectionGrade("11")).toBeNull();
    expect(parseCollectionGrade("0")).toBeNull();
    expect(parseCollectionGrade("PSA 10")).toBeNull();
  });
});

describe("grade picker", () => {
  it("PSA has no 9.5 (measured: a 'PSA 9.5' sat in a collection 2026-10-15)", () => {
    expect(gradesForCollectionIssuer("PSA")).not.toContain("9.5");
    expect(gradesForCollectionIssuer("PSA")).toContain("10");
    expect(gradesForCollectionIssuer("Beckett")).toContain("9.5");
    expect(gradesForCollectionIssuer("CGC")).toContain("9.5");
  });

  it("every issuer the sheet offers still becomes a valid Tradera term", () => {
    for (const issuer of COLLECTION_GRADING_ISSUERS) {
      expect(["PSA", "Beckett", "CGC", "ACE", "Raukcard", "Övriga"]).toContain(traderaGradingIssuer(issuer));
    }
    expect(traderaGradingIssuer("SGC")).toBe("Övriga");
    expect(traderaGradingIssuer("TAG")).toBe("Övriga");
  });
});

describe("label text", () => {
  it("prints the issuers' own grade words", () => {
    expect(gradeWord("PSA", 100)).toBe("GEM MT");
    expect(gradeWord("PSA", 90)).toBe("MINT");
    expect(gradeWord("BGS", 100)).toBe("PRISTINE");
    expect(gradeWord("BGS", 95)).toBe("GEM MINT");
    expect(gradeWord("CGC", 100)).toBe("GEM MINT");
    expect(gradeWord("CGC", 95)).toBe("MINT+");
  });

  it("formats the grade number like the label does", () => {
    expect(gradeNumber(100)).toBe("10");
    expect(gradeNumber(95)).toBe("9.5");
    expect(gradeNumber(80)).toBe("8");
  });
});

describe("gradingPayload", () => {
  it("sends both fields or nothing", () => {
    expect(gradingPayload("PSA", "10")).toEqual({ gradingCompany: "PSA", grade: "10" });
    expect(gradingPayload("PSA", "")).toEqual({});
    expect(gradingPayload("", "10")).toEqual({});
    expect(gradingPayload(undefined, undefined)).toEqual({});
  });
});
