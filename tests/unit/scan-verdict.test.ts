/**
 * DOMSTYRKAN AVGÖR VAD SOM HAMNAR I FACIT — och felet är TYST.
 *
 * Glider ordningen fel skrivs en korrigering över av nästa masstryck, och det
 * märks först i en rapport veckor senare. Mätt 2026-08-29 var korrigeringarna
 * 2 av 649 domar; att tappa dem är inte ett kantfall, det är hela mätningen.
 */
import { describe, expect, it } from "vitest";
import { verdictStrength } from "@/lib/scan-verdict";

describe("verdictStrength", () => {
  it("en korrigering överlever ett efterföljande 'Lägg till alla'", () => {
    // DEN VANLIGA SEKVENSEN: användaren rättar ett kort i listan och trycker
    // sedan på masstillägget. Utan ordningen nollade det andra steget det första
    // varje gång — och det var precis det som gjorde 0 korrigeringar av 533
    // skur-domar i produktion.
    expect(verdictStrength("confirmed", "bulk")).toBeLessThan(
      verdictStrength("corrected", "pick")
    );
  });

  it("negativa domar väger tyngre än en bekräftelse", () => {
    // Att radera eller söka manuellt är facit om att vi hade FEL, och de är
    // anrikade med de svåra fallen. En senare masskonfirmation på samma jobb
    // (t.ex. via en annan flik) får inte radera dem.
    expect(verdictStrength("confirmed", "pick")).toBeLessThan(
      verdictStrength("searched", "pick")
    );
    expect(verdictStrength("searched", "pick")).toBeLessThan(
      verdictStrength("rejected", "pick")
    );
    expect(verdictStrength("rejected", "pick")).toBeLessThan(
      verdictStrength("corrected", "bulk")
    );
  });

  it("ett aktivt val slår ett masstryck INOM samma kind", () => {
    expect(verdictStrength("confirmed", "bulk")).toBeLessThan(
      verdictStrength("confirmed", "pick")
    );
  });

  it("`via` får ALDRIG lyfta en svagare kind förbi en starkare", () => {
    // Stegen mellan kind är 10 och mellan via 0–2 med flit. Krympte avståndet
    // hade en "confirmed via pick" kunnat slå en "searched via auto", dvs ett
    // masstryck hade kunnat sudda ett negativt facit.
    expect(verdictStrength("confirmed", "pick")).toBeLessThan(
      verdictStrength("searched", "auto")
    );
  });

  it("okänd eller saknad kind ger 0 — en gammal klient blockerar aldrig", () => {
    // Rader skrivna före 2026-08-29 saknar `via`, och en framtida klient kan
    // skicka en `kind` den här versionen inte känner. Ingen av dem får kunna
    // låsa ute en riktig dom.
    expect(verdictStrength(undefined, undefined)).toBe(0);
    expect(verdictStrength("nagot-nytt", "okant")).toBe(0);
    expect(verdictStrength(null, null)).toBe(0);
    expect(verdictStrength("confirmed", undefined)).toBeGreaterThan(0);
  });

  it("samma dom två gånger är lika stark — skrivningen är idempotent", () => {
    // Villkoret i routen avvisar bara STRIKT svagare. Dev-StrictMode dubbelkör
    // updatern som anropar reportScanFeedback, och den andra skrivningen ska
    // ge samma rad, inte avvisas.
    expect(verdictStrength("confirmed", "bulk")).toBe(verdictStrength("confirmed", "bulk"));
  });
});
