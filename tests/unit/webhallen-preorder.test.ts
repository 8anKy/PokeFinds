import { describe, it, expect } from "vitest";
import {
  webhallenStockStatus,
  webhallenStoreOnly,
  webhallenStoreStock,
  webhallenStoreBreakdown,
} from "@/scrapers/adapters/webhallen-adapter";
import { parseWebhallenStores, storeLabel } from "@/scrapers/adapters/webhallen-stores";

// Minimal WebhallenProduct-form; bara fälten webhallenStockStatus läser spelar roll.
const item = (stockWeb: number, releaseTs?: number, stores: Record<string, number> = {}) =>
  ({ id: 1, name: "x", price: { price: "1", currency: "SEK" }, stock: { web: stockWeb, ...stores }, release: releaseTs != null ? { timestamp: releaseTs } : null }) as never;

const future = Math.floor(Date.now() / 1000) + 30 * 86400;
const past = Math.floor(Date.now() / 1000) - 30 * 86400;

describe("webhallenStockStatus", () => {
  it("web-lager > 0 = i lager (även med framtida release)", () => {
    expect(webhallenStockStatus(item(5, future))).toBe("IN_STOCK");
  });
  it("inget lager + framtida release = förhandsbokning", () => {
    expect(webhallenStockStatus(item(0, future))).toBe("PREORDER");
  });
  it("inget lager + passerad release = ur lager", () => {
    expect(webhallenStockStatus(item(0, past))).toBe("OUT_OF_STOCK");
  });
  it("inget lager + inget release-datum = ur lager", () => {
    expect(webhallenStockStatus(item(0))).toBe("OUT_OF_STOCK");
  });

  // BUTIKSSLÄPP (30th Celebration 2026-09-19): web=0, isShippable=false, men butikerna
  // bär saldo. Ägarbeslut: butiksvara = i lager (som SF-Bok).
  it("web=0 men butikssaldo efter släppet = i lager (butiksvara)", () => {
    expect(webhallenStockStatus(item(0, past, { "2": 48, "5": 51, "27": 0 }))).toBe("IN_STOCK");
  });
  it("web=0 + butikssaldo men FRAMTIDA release = fortfarande förhandsbokning", () => {
    expect(webhallenStockStatus(item(0, future, { "2": 48 }))).toBe("PREORDER");
  });
  it("räknar bara numeriska butiksnycklar — displayCap/webStock/isSentFromStore är inga saldon", () => {
    expect(webhallenStoreStock({ web: 0, displayCap: 50, isSentFromStore: 0, isTrue: true, webStock: { "992": 3 } })).toBe(0);
    expect(webhallenStoreStock({ web: 0, "2": 48, "5": 51, "27": 0 })).toBe(99);
    expect(webhallenStoreStock(null)).toBe(0);
  });
});

// Etiketten på larmet: "hämta i butik" vs "beställ". Rör inte lagerdomen.
describe("webhallenStoreOnly", () => {
  it("web=0 + butikssaldo = endast i butik", () => {
    expect(webhallenStoreOnly(item(0, past, { "2": 48 }))).toBe(true);
  });
  it("webblager = online, även om butikerna också har saldo", () => {
    expect(webhallenStoreOnly(item(3, past, { "2": 48 }))).toBe(false);
  });
  it("slut/förhandsbokning är aldrig 'endast i butik'", () => {
    expect(webhallenStoreOnly(item(0, past))).toBe(false);
    expect(webhallenStoreOnly(item(0, future, { "2": 48 }))).toBe(false);
  });
});

// Talet i butikskanalens inlägg: hur många ex och i hur många butiker.
describe("webhallenStoreBreakdown", () => {
  it("summerar exemplar och räknar butiker med saldo", () => {
    // Mätt på 30th Celebration Binder Collection 2026-09-22.
    const r = webhallenStoreBreakdown({ web: 0, displayCap: 50, "5": 10, "9": 2, "14": 1, "15": 14, "19": 1, "32": 8, "2": 0 });
    expect(r.units).toBe(36);
    expect(r.stores).toBe(6);
    expect(r.capped).toBe(false);
  });

  it("⛔ displayCap är ett VISNINGSTAK — en butik på taket gör summan till ett GOLV", () => {
    // 50 betyder "Fler än 50 st". Publicerar vi 50 som ett exakt tal är det fel nedåt.
    const r = webhallenStoreBreakdown({ web: 0, displayCap: 50, "5": 50, "9": 3 });
    expect(r.capped).toBe(true);
    expect(r.units).toBe(53);
  });

  it("⛔ bara numeriska butiksnycklar — web/webStock/displayCap är inga saldon", () => {
    const r = webhallenStoreBreakdown({ web: 7, displayCap: 50, isSentFromStore: 0, isTrue: true, webStock: { "992": 3 } });
    expect(r).toEqual({ units: 0, stores: 0, capped: false, locations: [], byStore: {} });
  });

  it("utan lagerobjekt är allt OKÄNT, aldrig noll", () => {
    expect(webhallenStoreBreakdown(null)).toEqual({ units: null, stores: null, capped: false });
  });

  it("webhallenStoreStock är oförändrad — lagerdomen får inte röras", () => {
    expect(webhallenStoreStock({ web: 0, "2": 48, "5": 51, "27": 0 })).toBe(99);
    expect(webhallenStoreStock(null)).toBe(0);
  });
});

/**
 * BUTIKSNAMNEN (2026-09-22). De numeriska lagernycklarna är id:n i Webhallens egen
 * butikslista, `/api/store/se` — endpointen står i klartext i deras frontend-bundle.
 * ⛔ Lärdomen är generell: läs butikens JS innan du förklarar en uppgift omöjlig.
 *    Första probningen gissade URL:er (/api/store, /api/store/{id}) och drog fel slutsats.
 */
describe("webhallens butikslista", () => {
  const api = {
    stores: [
      { id: 31, name: "Bredden (InfraCity)", city: "Upplands Väsby" },
      { id: 33, name: "Solna Centrum", city: "Solna" },
      { id: 32, name: "Ringen", city: "Stockholm" },
      { id: 0, name: "", city: "Ingen" },
    ],
  };

  it("läser id, namn och ort och hoppar över namnlösa rader", () => {
    const m = parseWebhallenStores(api);
    expect(m.size).toBe(3);
    expect(m.get(31)!.name).toBe("Bredden (InfraCity)");
    expect(m.get(0)).toBeUndefined();
  });

  it("⛔ ett trasigt svar ger en TOM karta, aldrig ett kast — namnen får inte tysta larmet", () => {
    expect(parseWebhallenStores(null).size).toBe(0);
    expect(parseWebhallenStores({ stores: "nope" }).size).toBe(0);
    expect(parseWebhallenStores({}).size).toBe(0);
  });

  it("orten läggs till bara när den inte redan framgår av namnet", () => {
    expect(storeLabel({ id: 32, name: "Ringen", city: "Stockholm" })).toBe("Ringen, Stockholm");
    expect(storeLabel({ id: 33, name: "Solna Centrum", city: "Solna" })).toBe("Solna Centrum");
    expect(storeLabel({ id: 9, name: "Täby Centrum", city: "Täby" })).toBe("Täby Centrum");
    expect(storeLabel({ id: 1, name: "X", city: null })).toBe("X");
  });

  it("nedbrytningen namnger butikerna och sorterar störst först", () => {
    const names = parseWebhallenStores(api);
    const r = webhallenStoreBreakdown({ web: 0, displayCap: 50, "31": 4, "32": 9, "33": 1 }, names);
    expect(r.locations!.map((l) => l.label)).toEqual([
      "Ringen, Stockholm",
      "Bredden (InfraCity), Upplands Väsby",
      "Solna Centrum",
    ]);
    expect(r.units).toBe(14);
  });

  it("⛔ ett OKÄNT id får INGEN rad — men räknas fortfarande i summan och antalet", () => {
    // Annars försvinner en nyöppnad butiks saldo ur talet, och ingen skulle märka det.
    const r = webhallenStoreBreakdown({ web: 0, "31": 4, "77": 6 }, parseWebhallenStores(api));
    expect(r.units).toBe(10);
    expect(r.stores).toBe(2);
    expect(r.locations!.map((l) => l.label)).toEqual(["Bredden (InfraCity), Upplands Väsby"]);
  });
});
