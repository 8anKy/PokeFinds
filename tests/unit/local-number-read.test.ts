/**
 * Tolkningen av on-device-OCR:ns text till ett samlarnummer (skuggläget).
 * Ren funktion — samma kod i appen och i mätskriptet.
 */
import { describe, expect, it } from "vitest";
import { analyzeStripText, hasJapaneseScript } from "@/lib/local-number-read";
import { cardNumberSortKey } from "@/lib/card-number-order";

describe("analyzeStripText", () => {
  it("läser 'n/N' ur en typisk SV-remsa och tar bort ledande nollor", () => {
    const r = analyzeStripText("Illus. Mitsuhiro Arita\n042/165 ©2023 Pokémon/Nintendo/Creatures/GAME FREAK");
    expect(r.number).toEqual({ printed: "42", num: 42, total: 165 });
    expect(r.candidates).toBe(1);
    // Samma nyckel som katalogen — det är så numret jämförs mot Card.number.
    expect(cardNumberSortKey(r.number!.printed)).toBe(cardNumberSortKey("042"));
  });

  it("bokstavsprefix är en del av numret (TG/GG/SV)", () => {
    expect(analyzeStripText("TG10/TG30").number).toEqual({ printed: "TG10", num: 10, total: 30 });
    expect(analyzeStripText("GG08/GG70").number?.printed).toBe("GG8");
    expect(analyzeStripText("SV075/SV198").number?.printed).toBe("SV75");
    expect(cardNumberSortKey("SV75")).toBe(cardNumberSortKey("SV075"));
  });

  it("suffix följer med (130a/132)", () => {
    expect(analyzeStripText("130a/132").number).toEqual({ printed: "130a", num: 130, total: 132 });
  });

  it("⛔ prefixet är VERSALER intill siffrorna — inte svansen på ett namn", () => {
    // "Sugimori 042/165": en fri [A-Za-z]{0,5}\s* gav "imori42".
    expect(analyzeStripText("Ken Sugimori 042/165").number?.printed).toBe("42");
  });

  it("årtal och småbråk är inte nummer", () => {
    expect(analyzeStripText("©2023 Pokémon 1/2").number).toBeNull();
    // "25/2023" ur en copyright-rad får inte bli kort 25.
    expect(analyzeStripText("25/2023").number).toBeNull();
  });

  it("vid flera kandidater vinner den som ser ut som ett samlarnummer", () => {
    // Två kort skymtar i plastfickan: 199/165 (secret rare, num > total) och 042/165.
    const r = analyzeStripText("199/165 042/165");
    expect(r.number?.printed).toBe("42");
    expect(r.candidates).toBe(2);
    // Ensam secret rare tas ändå — num > total är vanligt, inte fel.
    expect(analyzeStripText("199/165").number).toEqual({ printed: "199", num: 199, total: 165 });
  });

  it("promonummer utan total (SWSH034, SVP 048) tas bara när ingen n/N finns", () => {
    expect(analyzeStripText("SWSH034 ©2021").number).toEqual({ printed: "SWSH34", num: 34, total: null });
    expect(analyzeStripText("SVP 048").number?.printed).toBe("SVP48");
    expect(analyzeStripText("SWSH034 042/165").number?.printed).toBe("42");
  });

  it("fullbredds-snedstreck (JP) och luft runt strecket", () => {
    expect(analyzeStripText("042／165").number?.printed).toBe("42");
    expect(analyzeStripText("042 / 165").number?.printed).toBe("42");
  });

  it("tom eller nummerlös text ⇒ null, 0 kandidater", () => {
    expect(analyzeStripText("")).toEqual({ number: null, candidates: 0 });
    expect(analyzeStripText("Illus. Ryota Murayama")).toEqual({ number: null, candidates: 0 });
  });
});

describe("hasJapaneseScript", () => {
  it("kana och kanji", () => {
    expect(hasJapaneseScript("ポケモン 042/165")).toBe(true);
    expect(hasJapaneseScript("042/165 ©2023 Pokémon")).toBe(false);
  });
});
