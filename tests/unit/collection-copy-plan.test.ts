import { describe, expect, it } from "vitest";
import { planCopyEdits, type CopyEdit } from "@/lib/collection-lots";

/**
 * EXEMPLARARKET SKRIVER I ANVÄNDARENS SAMLING — en bugg här raderar någons kort.
 * Domen ligger därför i en ren funktion, precis som `shouldCloseSheet` och
 * `price-alert-rule`: den går att testa utan DOM, utan nätverk och utan databas.
 */
function lot(id: string, quantity: number, purchasePrice: number | null) {
  return {
    id,
    cardId: "c1",
    productId: null,
    quantity,
    condition: "NEAR_MINT",
    language: "JP",
    gradingCompany: null,
    grade: null,
    purchasePrice,
  };
}

/** Alla exemplar ur ett köp, orörda. */
function copiesOf(lotId: string, n: number, price: number | null): CopyEdit[] {
  return Array.from({ length: n }, () => ({ lotId, purchasePrice: price, remove: false }));
}

describe("planCopyEdits", () => {
  it("rör ingenting när inget ändrats — att öppna arket och stänga kostar noll", () => {
    const lots = [lot("a", 4, 10000)];
    const plan = planCopyEdits(lots, copiesOf("a", 4, 10000));
    expect(plan).toEqual({ deletes: [], patches: [], creates: [], removed: 0 });
  });

  it("tar bort ett exemplar ur ett köp med fyra ⇒ antalet skrivs ner", () => {
    const lots = [lot("a", 4, 10000)];
    const copies = copiesOf("a", 4, 10000);
    copies[0].remove = true;
    const plan = planCopyEdits(lots, copies);
    expect(plan.removed).toBe(1);
    expect(plan.deletes).toEqual([]);
    expect(plan.patches).toEqual([{ lot: lots[0], quantity: 3, purchasePrice: 10000 }]);
    expect(plan.creates).toEqual([]);
  });

  it("tar bort ALLA exemplar ⇒ köpet raderas, aldrig ett PATCH till noll", () => {
    const lots = [lot("a", 2, 10000)];
    const copies = copiesOf("a", 2, 10000).map((c) => ({ ...c, remove: true }));
    const plan = planCopyEdits(lots, copies);
    expect(plan.deletes).toEqual([lots[0]]);
    expect(plan.patches).toEqual([]);
    expect(plan.removed).toBe(2);
  });

  it("ett eget pris på ETT exemplar bryter ut det till ett eget köp", () => {
    const lots = [lot("a", 3, 10000)];
    const copies = copiesOf("a", 3, 10000);
    copies[2].purchasePrice = 25000;
    const plan = planCopyEdits(lots, copies);
    // Första gruppen behåller raden …
    expect(plan.patches).toEqual([{ lot: lots[0], quantity: 2, purchasePrice: 10000 }]);
    // … resten blir ett eget köp. Två priser ÄR två poster i den här modellen.
    expect(plan.creates).toEqual([{ lot: lots[0], quantity: 1, purchasePrice: 25000 }]);
  });

  it("tomt pris är 'vet inte', inte 0 kr — och är en egen grupp", () => {
    const lots = [lot("a", 2, 10000)];
    const copies = copiesOf("a", 2, 10000);
    copies[1].purchasePrice = null;
    const plan = planCopyEdits(lots, copies);
    expect(plan.patches).toEqual([{ lot: lots[0], quantity: 1, purchasePrice: 10000 }]);
    expect(plan.creates).toEqual([{ lot: lots[0], quantity: 1, purchasePrice: null }]);
    // ⛔ Aldrig 0 — noll betyder "fick gratis".
    expect(plan.creates[0].purchasePrice).not.toBe(0);
  });

  it("hela köpet får ett nytt pris ⇒ ETT patch, ingen ny rad", () => {
    const lots = [lot("a", 2, 10000)];
    const plan = planCopyEdits(lots, copiesOf("a", 2, 25000));
    expect(plan.patches).toEqual([{ lot: lots[0], quantity: 2, purchasePrice: 25000 }]);
    expect(plan.creates).toEqual([]);
  });

  /**
   * ⛔ ORDNINGSFÄLLAN. `addCollectionItem` staplar ett nytt köp på en befintlig
   * post med samma identitet OCH samma pris. Skrevs skapelserna löpande kunde en
   * av dem landa på köp B innan B skrivits om — och B:s omskrivning, som räknar
   * på antalet B hade när arket öppnades, hade sedan skrivit ner det igen och
   * tyst raderat de instaplade exemplaren. Planen håller dem åtskilda.
   */
  it("skapelser hålls åtskilda från omskrivningar (staplings-fällan)", () => {
    const lots = [lot("a", 2, 10000), lot("b", 1, 25000)];
    const copies = [...copiesOf("a", 2, 10000), ...copiesOf("b", 1, 25000)];
    copies[1].purchasePrice = 25000; // ett av A:s exemplar får B:s pris
    copies[2].purchasePrice = 30000; // och B får ett nytt pris
    const plan = planCopyEdits(lots, copies);
    // Båda köpen skrivs om först …
    expect(plan.patches).toEqual([
      { lot: lots[0], quantity: 1, purchasePrice: 10000 },
      { lot: lots[1], quantity: 1, purchasePrice: 30000 },
    ]);
    // … och först därefter läggs det utbrutna exemplaret till.
    expect(plan.creates).toEqual([{ lot: lots[0], quantity: 1, purchasePrice: 25000 }]);
  });

  it("räknar bort över flera köp i samma vara", () => {
    const lots = [lot("a", 2, 10000), lot("b", 3, 20000)];
    const copies = [...copiesOf("a", 2, 10000), ...copiesOf("b", 3, 20000)];
    copies[0].remove = true;
    copies[3].remove = true;
    copies[4].remove = true;
    const plan = planCopyEdits(lots, copies);
    expect(plan.removed).toBe(3);
    expect(plan.patches).toEqual([
      { lot: lots[0], quantity: 1, purchasePrice: 10000 },
      { lot: lots[1], quantity: 1, purchasePrice: 20000 },
    ]);
  });
});
