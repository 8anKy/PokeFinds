import { describe, it, expect } from "vitest";
import {
  cardmarketProductUrl,
  isDirectOfferUrl,
  isEnglishCardmarketUrl,
  withFirstEd,
  withNearMint,
} from "../../src/lib/marketplace-urls";
import { cmCardNameAgrees, cmNameKey } from "../../src/jobs/cardmarket-refresh";

// 2026-07-28: CM har bara TVÅ produkter per Base-kort — Shadowless och 1st Edition
// delar den ena, där 1st Edition är en FLAGGA på annonsen. Utan isFirstEd=Y pekade
// våra två tryckningsprodukter på exakt samma osorterade sida, fast bara den ena
// tryckningens annonser gav priset vi publicerar. Verifierat mot CM samma dag:
// idProduct=660184 + isFirstEd=Y → Bulbasaur-V2-BS44 med EN annons (600 €), vilket
// är precis vad feedens "1st Edition Shadowless"-rad rapporterar som From.

describe("withFirstEd — Cardmarkets 1st Edition-filter", () => {
  it("lägger på filtret på en CM-länk", () => {
    expect(withFirstEd("https://www.cardmarket.com/en/Pokemon/Products?idProduct=660184&language=1"))
      .toBe("https://www.cardmarket.com/en/Pokemon/Products?idProduct=660184&language=1&isFirstEd=Y");
  });

  it("är idempotent — självläkningen får inte dubblera parametern", () => {
    const once = withFirstEd(cardmarketProductUrl(660184, { nearMint: true }));
    expect(withFirstEd(once)).toBe(once);
    expect(once.match(/isFirstEd=/g)).toHaveLength(1);
  });

  it("rör inte länkar utanför cardmarket.com", () => {
    const tradera = "https://www.tradera.com/item/1001337/1/bulbasaur";
    expect(withFirstEd(tradera)).toBe(tradera);
  });

  it("tål tom/saknad URL", () => {
    expect(withFirstEd(null)).toBe("");
    expect(withFirstEd(undefined)).toBe("");
  });
});

describe("cardmarketProductUrl med tryckning", () => {
  it("1st Edition får BÅDE Near Mint- och 1st Edition-filtret", () => {
    const url = cardmarketProductUrl(660184, { nearMint: true, firstEd: true });
    expect(url).toContain("idProduct=660184");
    expect(url).toContain("language=1");
    expect(url).toContain("minCondition=2");
    expect(url).toContain("isFirstEd=Y");
  });

  it("Shadowless får SAMMA produkt men utan 1st Edition-filtret", () => {
    const shadowless = cardmarketProductUrl(660184, { nearMint: true });
    expect(shadowless).toContain("idProduct=660184");
    expect(shadowless).not.toContain("isFirstEd");
  });

  it("filtret bevarar länkens identitet — idProduct läses fortfarande ut", () => {
    // cardmarket-refresh hämtar guide-raden ur offerns URL; en extra parameter
    // får inte störa den uppslagningen.
    const url = cardmarketProductUrl(660146, { nearMint: true, firstEd: true });
    expect(Number(url.match(/idProduct=(\d+)/)?.[1])).toBe(660146);
    expect(isEnglishCardmarketUrl(url)).toBe(true);
    expect(isDirectOfferUrl(url)).toBe(true);
    // withNearMint är fortfarande idempotent på den filtrerade länken (jobbet
    // kör den på varje befintlig CM-länk).
    expect(withNearMint(url)).toBe(url);
  });
});

// CM stavar Base 73 "Imposter Professor Oak", pokemontcg.io "Impostor". Namnvakten
// avvisade därför CM:s Unlimited- och Shadowless-rader, och Unlimited-produkten blev
// kvar på 1st Edition-radens pris (125 € = 1 382 kr) efter uppdelningen.
describe("cmNameKey — CM:s egen stavning", () => {
  it("Imposter/Impostor Professor Oak är samma kort", () => {
    expect(cmNameKey("Imposter Professor Oak")).toBe(cmNameKey("Impostor Professor Oak"));
    expect(cmCardNameAgrees("Impostor Professor Oak", "Imposter Professor Oak")).toBe(true);
  });

  it("men Professor Oak är ETT ANNAT kort (Base 88)", () => {
    expect(cmCardNameAgrees("Impostor Professor Oak", "Professor Oak")).toBe(false);
    expect(cmCardNameAgrees("Professor Oak", "Imposter Professor Oak")).toBe(false);
  });
});
