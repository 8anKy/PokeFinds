import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Skäligt bruk-taket är ett AVTALSVILLKOR, inte bara en skyddsspärr (ägarbeslut
 * 2026-08-02): talet är publicerat i användarvillkoren, och ett dolt tak under
 * det publicerade är ett villkor kunden aldrig fått se. Konstanten
 * `PREMIUM_FAIR_USE` och villkorstexten måste därför ändras TILLSAMMANS.
 *
 * Samma metod som bulk-cap-sync: talen läses ur källorna som text, för
 * scanner-tjänsten drar in prisma och villkorstexten bor i JSON.
 * (Nyckeln hette Terms.s6FairUse t.o.m. 2026-08-08, nu s11FairUse.)
 */
function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("skäligt bruk-taket säger samma tal i kod och villkor", () => {
  const constant = () => {
    const m = read("src/services/scanner/index.ts").match(/PREMIUM_FAIR_USE = (\d+)/);
    expect(m, "PREMIUM_FAIR_USE hittades inte — har konstanten döpts om?").toBeTruthy();
    return Number(m![1]);
  };

  it("svenska villkoren bär konstantens tal", () => {
    const terms = JSON.parse(read("messages/sv.json")).Terms as Record<string, string>;
    // Svensk sifferskrivning: "1 000". Bygg strängen ur konstanten så testet
    // följer med om talet ändras.
    const svFormatted = constant().toLocaleString("sv-SE").replace(/ /g, " ");
    expect(terms.s11FairUse, `villkoren ska nämna ${svFormatted}`).toContain(svFormatted);
  });

  it("engelska villkoren bär konstantens tal", () => {
    const terms = JSON.parse(read("messages/en.json")).Terms as Record<string, string>;
    const enFormatted = constant().toLocaleString("en-GB");
    expect(terms.s11FairUse, `terms must mention ${enFormatted}`).toContain(enFormatted);
  });

  it("prissidans copy motsäger inte konstanten", () => {
    // Prissidan säger "obegränsad ... (skäligt bruk)" utan tal — det är rätt.
    // Skulle någon skriva in ETT ANNAT tal där än konstantens är det en glidning.
    for (const file of ["messages/sv.json", "messages/en.json"]) {
      const pricing = JSON.stringify(JSON.parse(read(file)).Pricing);
      const wrongNumbers = pricing.match(/\b(\d{3,4})\s*(skanningar|scans)\b/i);
      if (wrongNumbers) {
        expect(Number(wrongNumbers[1].replace(/\s/g, ""))).toBe(constant());
      }
    }
  });
});
