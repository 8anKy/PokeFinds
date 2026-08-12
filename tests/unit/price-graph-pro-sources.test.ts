import { describe, expect, it } from "vitest";
import {
  PRO_SOURCES,
  SOURCE_ORDER,
  sourceGate,
  type SourceKey,
} from "@/lib/price-graph-sources";

const none = new Set<string>();
/** Chip-tillståndet produktsidan startar i: allt utom den primära är avbockat. */
const onlyOn = (...on: SourceKey[]) => new Set<string>(SOURCE_ORDER.filter((k) => !on.includes(k)));

/**
 * Tradera-serierna (annons + sålt) är Pro (ägarbeslut 2026-08-13). Gratisanvändaren
 * ska se chipsen med ett lås men aldrig kunna välja dem — och kurvan får inte ritas
 * på någon annan väg heller. Se @/lib/price-graph-sources.
 */
describe("Tradera-serierna är Pro-låsta", () => {
  it("låser exakt Tradera-serierna, aldrig Cardmarket/CardTrader", () => {
    const { isLocked } = sourceGate(SOURCE_ORDER, none, false);
    expect(SOURCE_ORDER.filter(isLocked)).toEqual(["tradera", "traderaSold"]);
    expect([...PRO_SOURCES]).toEqual(["tradera", "traderaSold"]);
  });

  it("låser ingenting för Pro", () => {
    const { isLocked, selected, proGated } = sourceGate(SOURCE_ORDER, none, true);
    expect(SOURCE_ORDER.filter(isLocked)).toEqual([]);
    expect(selected).toEqual([...SOURCE_ORDER]);
    expect(proGated).toBe(false);
  });

  it("ritar aldrig en låst källa — inte ens om chip-tillståndet säger att den är PÅ", () => {
    // `off` är komponentens tillstånd och kan komma från en tidigare rendering
    // (t.ex. en Pro-session som gått ut). Grinden sitter därför i urvalet, inte i
    // knappen: en låst källa kan aldrig hamna i `selected`.
    const gate = sourceGate(["cardmarket", "tradera", "traderaSold"], none, false);
    expect(gate.selected).toEqual(["cardmarket"]);
    expect(gate.unlocked).toEqual(["cardmarket"]);
  });

  it("gratis: Cardmarket ritas, Tradera-chipet finns kvar (som lås) men är inte valt", () => {
    const available: SourceKey[] = ["cardmarket", "tradera"];
    const gate = sourceGate(available, onlyOn("cardmarket"), false);
    expect(gate.selected).toEqual(["cardmarket"]);
    expect(gate.isLocked("tradera")).toBe(true);
    expect(gate.proGated).toBe(false);
  });

  it("Pro kan lägga sålt ovanpå annonskurvan", () => {
    const gate = sourceGate(["cardmarket", "tradera", "traderaSold"], onlyOn("tradera", "traderaSold"), true);
    expect(gate.selected).toEqual(["tradera", "traderaSold"]);
  });

  /**
   * De 37 produkter (mätt i prod 2026-08-13) vars enda historik är Tradera. Utan
   * `proGated` blir `selected` tom, och då faller grafen tillbaka på trendserien —
   * som PÅ dessa produkter ÄR Tradera-serien. Låset måste alltså ersätta grafen,
   * inte bara chipet.
   */
  it("bara Tradera-serier + gratis ⇒ proGated (låset ersätter grafen)", () => {
    for (const available of [["tradera"], ["traderaSold"], ["tradera", "traderaSold"]] as SourceKey[][]) {
      const gate = sourceGate(available, none, false);
      expect(gate.selected).toEqual([]);
      expect(gate.proGated).toBe(true);
    }
  });

  it("bara Tradera-serier + Pro ⇒ ingen grind", () => {
    const gate = sourceGate(["tradera"], none, true);
    expect(gate.selected).toEqual(["tradera"]);
    expect(gate.proGated).toBe(false);
  });

  it("produkt helt utan historik grindas inte (grafen har sin egen tomstate)", () => {
    expect(sourceGate([], none, false).proGated).toBe(false);
  });

  /**
   * ⛔ FÖRVALET MÅSTE VARA EN FRI KÄLLA. Produktsidan väljer `available[0]` när
   * Cardmarket saknas, så ligger en Pro-källa före en fri i `SOURCE_ORDER` öppnar
   * sidan på en låst serie — grafen står tom fast produkten har data att visa.
   */
  it("de fria källorna ligger först i SOURCE_ORDER", () => {
    const firstPro = SOURCE_ORDER.findIndex((k) => PRO_SOURCES.includes(k));
    const lastFree = SOURCE_ORDER.reduce((acc, k, i) => (PRO_SOURCES.includes(k) ? acc : i), -1);
    expect(firstPro).toBeGreaterThan(lastFree);
  });
});
