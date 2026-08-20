/**
 * Set-portföljens aggregering. `buildSetPortfolio` är ren — ingen databas, inga
 * mockar. Fallen speglar de invarianter som faktiskt kostat oss något tidigare:
 * lots får inte dubbelräknas, ett okänt värde får aldrig bli 0 kr, och summan av
 * set-raderna MÅSTE bli samma tal som nyckeltalskortet ovanför fliken.
 */
import { describe, expect, it } from "vitest";
import {
  buildSetPortfolio,
  type PortfolioItemInput,
  type SetDenominator,
} from "@/services/set-portfolio";

const SET_A = "set-a";
const denomA: SetDenominator = {
  setId: SET_A,
  name: "Pitch Black",
  series: "Mega Evolution",
  logoUrl: null,
  totalCards: 84,
  totalCardsFull: 120,
  cardCount: 120,
  printingsTotal: 187,
  listedPrintings: 187,
};

function card(
  id: string,
  cardId: string,
  opts: Partial<PortfolioItemInput> & { variantLabel?: string | null } = {}
): PortfolioItemInput {
  return {
    id,
    quantity: opts.quantity ?? 1,
    cardId,
    productId: opts.productId ?? `p-${id}`,
    card: { set: { id: SET_A, name: "Pitch Black" } },
    product: { setId: SET_A, variantLabel: opts.variantLabel ?? null },
  };
}

describe("buildSetPortfolio", () => {
  it("räknar LOTS en gång men exemplar för sig", () => {
    // Två köp av samma kort till olika pris = två rader (lots) — men ETT kort ägt.
    const rows = buildSetPortfolio(
      [card("1", "c1"), card("2", "c1", { quantity: 3 })],
      {},
      [denomA]
    );
    expect(rows[0].ownedCards).toBe(1);
    expect(rows[0].copies).toBe(4);
  });

  it("mäter mot HELA setet, inte mot det tryckta talet", () => {
    const rows = buildSetPortfolio([card("1", "c1")], {}, [denomA]);
    expect(rows[0].total).toBe(120);
    expect(rows[0].percent).toBe(1);
  });

  it("okänt värde ger null och räknas — aldrig 0 kr", () => {
    const rows = buildSetPortfolio([card("1", "c1"), card("2", "c2")], {}, [denomA]);
    expect(rows[0].valueOre).toBeNull();
    expect(rows[0].valueMissingCount).toBe(2);
  });

  it("värdet är PER STYCK och multipliceras med antalet", () => {
    // Samma regel som computeCollectionValue: totalValue += v * quantity.
    const rows = buildSetPortfolio([card("1", "c1", { quantity: 3 })], { "1": 5000 }, [
      denomA,
    ]);
    expect(rows[0].valueOre).toBe(15000);
    expect(rows[0].valueMissingCount).toBe(0);
  });

  it("summan över set-raderna är samma tal som samlingens totalvärde", () => {
    const items = [
      card("1", "c1", { quantity: 2 }),
      card("2", "c2"),
      {
        id: "3",
        quantity: 1,
        cardId: "c3",
        productId: "p3",
        card: { set: { id: "set-b", name: "Chaos Rising" } },
        product: { setId: "set-b", variantLabel: null },
      } satisfies PortfolioItemInput,
    ];
    const values = { "1": 1000, "2": 250, "3": 7000 };
    const total = Object.entries(values).reduce((sum, [id, v]) => {
      const q = items.find((i) => i.id === id)!.quantity;
      return sum + v * q;
    }, 0);
    const rows = buildSetPortfolio(items, values, [denomA]);
    expect(rows.reduce((s, r) => s + (r.valueOre ?? 0), 0)).toBe(total);
  });

  it("varianter räknas som EGNA tryckningar i master set", () => {
    const rows = buildSetPortfolio(
      [
        card("1", "c1"), // ordinarie
        card("2", "c1", { variantLabel: "Reverse Holo" }),
      ],
      {},
      [denomA]
    );
    expect(rows[0].ownedCards).toBe(1);
    expect(rows[0].ownedPrintings).toBe(2);
    expect(rows[0].printings).toBe(187);
  });

  it("en post utan produkt räknas som den ordinarie tryckningen, aldrig som en gissad variant", () => {
    const manual: PortfolioItemInput = {
      id: "m",
      quantity: 1,
      cardId: "c1",
      productId: null,
      card: { set: { id: SET_A, name: "Pitch Black" } },
      product: null,
    };
    const rows = buildSetPortfolio([manual, card("1", "c1")], {}, [denomA]);
    expect(rows[0].ownedPrintings).toBe(1);
  });

  it("ingen master set-rad när setet saknar varianter att jaga", () => {
    const flat: SetDenominator = { ...denomA, printingsTotal: 120, listedPrintings: 120 };
    const rows = buildSetPortfolio([card("1", "c1")], {}, [flat]);
    expect(rows[0].printings).toBeNull();
    expect(rows[0].masterPercent).toBeNull();
  });

  it("noten om fler tryckningar visas bara när facit är större än vår lista", () => {
    const short: SetDenominator = { ...denomA, printingsTotal: 240, listedPrintings: 187 };
    const rows = buildSetPortfolio([card("1", "c1")], {}, [short]);
    expect(rows[0].printings).toBe(187); // nämnaren förblir NÅBAR
    expect(rows[0].printingsElsewhere).toBe(240);
  });

  it("okänd nämnare ⇒ null, aldrig 0 % (japanska set utan kort)", () => {
    const jp: SetDenominator = {
      setId: "jp",
      name: "Black Bolt (SV11B)",
      series: "JP",
      logoUrl: null,
      totalCards: 0,
      totalCardsFull: 0,
      cardCount: 0,
      printingsTotal: 0,
      listedPrintings: 0,
    };
    const sealed: PortfolioItemInput = {
      id: "s1",
      quantity: 1,
      cardId: null,
      productId: "etb",
      card: null,
      product: { setId: "jp", variantLabel: null },
    };
    const rows = buildSetPortfolio([sealed], { s1: 45000 }, [jp]);
    expect(rows[0].total).toBeNull();
    expect(rows[0].percent).toBeNull();
    expect(rows[0].sealedOnly).toBe(true);
    expect(rows[0].valueOre).toBe(45000);
  });

  it("sealed räknas aldrig som ett kort i setet", () => {
    const sealed: PortfolioItemInput = {
      id: "s1",
      quantity: 1,
      cardId: null,
      productId: "etb",
      card: null,
      product: { setId: SET_A, variantLabel: null },
    };
    const rows = buildSetPortfolio([sealed, card("1", "c1")], {}, [denomA]);
    expect(rows[0].ownedCards).toBe(1);
    expect(rows[0].sealedOnly).toBe(false);
  });

  it("katalogen kortare än setet flaggas så 100 % aldrig utlovas", () => {
    const short: SetDenominator = { ...denomA, totalCardsFull: 190, cardCount: 150 };
    const rows = buildSetPortfolio([card("1", "c1")], {}, [short]);
    expect(rows[0].total).toBe(190);
    expect(rows[0].catalogShort).toBe(true);
  });

  it("poster helt utan set hoppas över i stället för att bilda en tom rad", () => {
    const orphan: PortfolioItemInput = {
      id: "o",
      quantity: 1,
      cardId: null,
      productId: null,
      card: null,
      product: null,
    };
    expect(buildSetPortfolio([orphan], {}, [denomA])).toHaveLength(0);
  });
});
