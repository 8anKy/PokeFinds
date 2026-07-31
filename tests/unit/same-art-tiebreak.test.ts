/**
 * OMTRYCKSSYSKON-TIE-BREAKEN: inom en bekräftad samma-konst-grupp ska
 * bildpoängens brus utjämnas (identisk konst → skillnaden ÄR brus), en
 * HP-bonus bara få skilja syskon när ALLA i gruppen har HP i katalogen
 * (Ascended Heroes-korten har hp=NULL — katalog-lucka, inte bevis), läst
 * total få ordna syskonen, och ingenting utanför gruppen röras. Fallen är
 * de VERKLIGA missarna från första facitmätningen 2026-07-31.
 */
import { describe, expect, it } from "vitest";
import { applySameArtTiebreak, type SameArtEntry } from "@/services/scanner/index";

const sim =
  (table: Record<string, number>) =>
  async (a: string, b: string): Promise<number | null> =>
    table[`${a}|${b}`] ?? table[`${b}|${a}`] ?? null;

const entry = (over: Partial<SameArtEntry> & { cardId: string }): SameArtEntry => ({
  name: "X",
  art: 0.7,
  totalCards: 0,
  scoreSansTiebreak: 1.0,
  hpBonus: 0,
  eraBonus: 0,
  hpKnown: true,
  ...over,
});

describe("applySameArtTiebreak", () => {
  it("utjämnar bildbrus till EXAKT lika poäng (Raboot-fallet)", async () => {
    // SC 27 vann på 0,005 bildbrus; efter utjämning ska poängen vara identisk
    // så att "nyast set först" (utanför funktionen) får avgöra.
    const entries = [
      entry({ cardId: "sc27", name: "Raboot", art: 0.645, scoreSansTiebreak: 1.2235 }),
      entry({ cardId: "ah37", name: "Raboot", art: 0.64, scoreSansTiebreak: 1.222, hpKnown: false }),
    ];
    const adj = await applySameArtTiebreak(entries, sim({ "sc27|ah37": 0.964 }), null, 1);
    expect(adj.get("sc27")).toBeCloseTo(adj.get("ah37")!, 10);
  });

  it("HP-bonus IGNORERAS när en gruppmedlem saknar HP i katalogen (AH-hålet)", async () => {
    // Modellen läste HP rätt från kortet; bara den GAMLA tvillingen har HP i
    // katalogen → +0,04 för fel syskon. Regeln: HP får inte rösta i gruppen.
    const entries = [
      entry({ cardId: "gammal", art: 0.7, hpBonus: 0.04, eraBonus: 0.02, hpKnown: true }),
      entry({ cardId: "ny", art: 0.7, hpBonus: 0, eraBonus: 0.02, hpKnown: false }),
    ];
    const adj = await applySameArtTiebreak(entries, sim({ "gammal|ny": 0.96 }), null, 1);
    expect(adj.get("gammal")).toBeCloseTo(adj.get("ny")!, 10);
  });

  it("HP FÅR skilja syskonen när båda har HP i katalogen (äkta läsning)", async () => {
    const entries = [
      entry({ cardId: "a", hpBonus: 0.04, hpKnown: true }),
      entry({ cardId: "b", hpBonus: 0, hpKnown: true }),
    ];
    const adj = await applySameArtTiebreak(entries, sim({ "a|b": 0.96 }), null, 1);
    expect(adj.get("a")! - adj.get("b")!).toBeCloseTo(0.04, 3);
  });

  it("läst TOTAL ordnar syskonen (Scorbunny-fallet: '034/217' → 217-setet)", async () => {
    const entries = [
      entry({ cardId: "sc26", name: "Scorbunny", art: 0.664, totalCards: 142, hpBonus: 0.04, eraBonus: 0.02 }),
      entry({ cardId: "ah36", name: "Scorbunny", art: 0.646, totalCards: 217, eraBonus: 0.02, hpKnown: false }),
    ];
    const adj = await applySameArtTiebreak(entries, sim({ "sc26|ah36": 0.954 }), 217, 1);
    expect(adj.get("ah36")!).toBeGreaterThan(adj.get("sc26")!);
  });

  it("rör INTE namnsyskon med olika konst (Charizard Base vs TG03: 0,361)", async () => {
    const entries = [
      entry({ cardId: "base4", name: "Charizard", art: 0.8 }),
      entry({ cardId: "tg03", name: "Charizard", art: 0.75 }),
    ];
    const adj = await applySameArtTiebreak(entries, sim({ "base4|tg03": 0.361 }), null, 1);
    expect(adj.size).toBe(0);
  });

  it("ett läst nummer förblir överordnat utjämningen", async () => {
    // ah37 bär nummerbonus (+0,4 i scoreSansTiebreak); utjämningen (≤ ~0,006)
    // och HP-strykningen får inte välta den.
    const entries = [
      entry({ cardId: "sc27", art: 0.72, scoreSansTiebreak: 1.03, hpBonus: 0.04 }),
      entry({ cardId: "ah37", art: 0.702, scoreSansTiebreak: 1.43, hpKnown: false }),
    ];
    const adj = await applySameArtTiebreak(entries, sim({ "sc27|ah37": 0.964 }), null, 1);
    expect(adj.get("ah37")!).toBeGreaterThan(adj.get("sc27")!);
  });

  it("total-bonusen dämpas med nameWeight (misstrott modellsvar)", async () => {
    const entries = [
      entry({ cardId: "a", totalCards: 142 }),
      entry({ cardId: "b", totalCards: 217 }),
    ];
    const full = await applySameArtTiebreak(entries, sim({ "a|b": 0.95 }), 217, 1);
    const damped = await applySameArtTiebreak(entries, sim({ "a|b": 0.95 }), 217, 0.25);
    expect(full.get("b")! - full.get("a")!).toBeCloseTo(0.02, 3);
    expect(damped.get("b")! - damped.get("a")!).toBeCloseTo(0.005, 3);
  });

  it("gör inget när bilden bara såg en av syskonen", async () => {
    const entries = [
      entry({ cardId: "a", art: 0.7 }),
      entry({ cardId: "b", art: undefined }),
    ];
    const adj = await applySameArtTiebreak(entries, sim({ "a|b": 0.99 }), null, 1);
    expect(adj.size).toBe(0);
  });

  it("okänd parlikhet (index saknas) → ingen justering", async () => {
    const entries = [
      entry({ cardId: "a", art: 0.7 }),
      entry({ cardId: "b", art: 0.69 }),
    ];
    const adj = await applySameArtTiebreak(entries, async () => null, null, 1);
    expect(adj.size).toBe(0);
  });
});
