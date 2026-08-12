import { describe, it, expect } from "vitest";
import {
  normalizeCreatorCode,
  creatorRefAction,
  CREATOR_CODE_MAX_LENGTH,
  CREATOR_REF_MAX_AGE,
} from "@/lib/creator-ref";

describe("normalizeCreatorCode", () => {
  it("versaliserar — koden skrivs av för hand från en video", () => {
    expect(normalizeCreatorCode("emma")).toBe("EMMA");
    expect(normalizeCreatorCode("EmMa")).toBe("EMMA");
    expect(normalizeCreatorCode("  emma  ")).toBe("EMMA");
  });

  it("behåller bindestreck, understreck och siffror", () => {
    expect(normalizeCreatorCode("emma-tcg_23")).toBe("EMMA-TCG_23");
  });

  it("kastar skräptecken i stället för att förkasta koden", () => {
    // En TikTok-bio får ofta med skiljetecken efter länken. Att tappa
    // attributionen där hade varit tyst och omöjligt att felsöka.
    expect(normalizeCreatorCode("EMMA.")).toBe("EMMA");
    expect(normalizeCreatorCode("EMMA?utm=x")).toBe("EMMAUTMX");
    expect(normalizeCreatorCode("<script>")).toBe("SCRIPT");
  });

  it("ger null för tomt, saknat och rent skräp", () => {
    expect(normalizeCreatorCode(null)).toBeNull();
    expect(normalizeCreatorCode(undefined)).toBeNull();
    expect(normalizeCreatorCode("")).toBeNull();
    expect(normalizeCreatorCode("   ")).toBeNull();
    expect(normalizeCreatorCode("!!!")).toBeNull();
  });

  it("ger null över längdtaket — cookien är osignerad indata", () => {
    expect(normalizeCreatorCode("A".repeat(CREATOR_CODE_MAX_LENGTH))).toHaveLength(
      CREATOR_CODE_MAX_LENGTH
    );
    expect(normalizeCreatorCode("A".repeat(CREATOR_CODE_MAX_LENGTH + 1))).toBeNull();
  });
});

describe("creatorRefAction", () => {
  it("sätter cookien när en ny besökare kommer via en kreatörslänk", () => {
    expect(creatorRefAction("EMMA", null)).toEqual({ type: "set", value: "EMMA" });
  });

  it("gör ingenting på sidvisningar utan ?ref=", () => {
    expect(creatorRefAction(null, null)).toEqual({ type: "none" });
    expect(creatorRefAction(null, "EMMA")).toEqual({ type: "none" });
  });

  it("SISTA KLICKET VINNER: Kalles länk skriver över Emmas cookie", () => {
    expect(creatorRefAction("KALLE", "EMMA")).toEqual({ type: "set", value: "KALLE" });
  });

  it("skriver INTE om cookien vid samma kod — fönstret räknas från klicket", () => {
    // Utan den här grenen förlängs de 30 dygnen vid varje sidvisning, dvs en
    // cookie som aldrig går ut för den som bläddrar regelbundet.
    expect(creatorRefAction("EMMA", "EMMA")).toEqual({ type: "none" });
    // …även när kapitaliseringen skiljer sig, eftersom båda normaliseras.
    expect(creatorRefAction("emma", "EMMA")).toEqual({ type: "none" });
  });

  it("ignorerar en ?ref= som normaliserar till ingenting", () => {
    expect(creatorRefAction("!!!", "EMMA")).toEqual({ type: "none" });
  });

  it("attributionsfönstret är 30 dygn", () => {
    expect(CREATOR_REF_MAX_AGE).toBe(60 * 60 * 24 * 30);
  });
});
