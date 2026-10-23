import { describe, expect, it } from "vitest";
import { euRrpByCmId, extractEuRrp } from "@/lib/eu-rrp";

const p = (price: number, currency: string) => ({ price, currency });

describe("extractEuRrp", () => {
  it("tar EU-priset i EUR-cent", () => {
    expect(extractEuRrp({ cardmarket_id: 1, lang: "en", msrp: { us: p(26.94, "USD"), eu: p(29.99, "EUR"), uk: p(23.94, "GBP") } })).toBe(2999);
  });
  it("ett samma tal i alla tre valutor är en kopia, inget europris", () => {
    expect(extractEuRrp({ cardmarket_id: 1, msrp: { us: p(49.99, "USD"), eu: p(49.99, "EUR"), uk: p(49.99, "GBP") } })).toBeNull();
  });
  it("aldrig USD eller GBP som EU", () => {
    expect(extractEuRrp({ cardmarket_id: 1, msrp: { us: p(59.99, "USD"), eu: null, uk: p(54.99, "GBP") } })).toBeNull();
    expect(extractEuRrp({ cardmarket_id: 1, msrp: { eu: p(29.99, "USD") } })).toBeNull();
  });
  it("bara EU räcker (äldre produkter saknar us/uk)", () => {
    expect(extractEuRrp({ cardmarket_id: 1, msrp: { eu: p(4.5, "EUR") } })).toBe(450);
  });
  it("nollor, negativa, orimliga och icke-engelska rader faller bort", () => {
    expect(extractEuRrp({ cardmarket_id: 1, msrp: { eu: p(0, "EUR") } })).toBeNull();
    expect(extractEuRrp({ cardmarket_id: 1, msrp: { eu: p(99_999, "EUR") } })).toBeNull();
    expect(extractEuRrp({ cardmarket_id: 1, lang: "jp", msrp: { eu: p(10, "EUR") } })).toBeNull();
    expect(extractEuRrp({ cardmarket_id: 1, msrp: null })).toBeNull();
  });
});

describe("euRrpByCmId", () => {
  it("null = raden finns men saknar europris (töm), saknad nyckel = rör inte", () => {
    const m = euRrpByCmId([
      { cardmarket_id: 10, msrp: { eu: p(29.99, "EUR") } },
      { cardmarket_id: 11, msrp: null },
      { cardmarket_id: null, msrp: { eu: p(5, "EUR") } },
    ]);
    expect(m.get(10)).toBe(2999);
    expect(m.has(11)).toBe(true);
    expect(m.get(11)).toBeNull();
    expect(m.size).toBe(2);
  });
  it("två rader med samma id och olika tal ⇒ null", () => {
    const m = euRrpByCmId([
      { cardmarket_id: 10, msrp: { eu: p(13, "EUR") } },
      { cardmarket_id: 10, msrp: { eu: p(15, "EUR") } },
    ]);
    expect(m.get(10)).toBeNull();
  });
});
