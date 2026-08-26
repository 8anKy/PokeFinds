/**
 * Vaktar att vi inte SÄLJER restock-larm medan de är avstängda.
 *
 * Regressionen som gav testet: pausen 2026-08-23 stängde av larmen men rörde
 * inte ett ord av copyn. `/priser` — som i appen ÄR hela paywallen (Capacitor-
 * WebView över exakt den rutten) — fortsatte lista "alla restock-larm" som en
 * Pro-förmån i tre av åtta punkter. Två kunder hann köpa: en 2026-08-22, elva
 * timmar innan pausbeskedet nådde deras inkorg, och en 2026-08-24 som aldrig
 * fick beskedet alls (engångsutskicket hade redan gått).
 *
 * ⛔ TESTET ÄR TVÅSIDIGT MED FLIT. Det räcker inte att punkterna FÖRSVINNER när
 * larmen är av — de måste också KOMMA TILLBAKA när de slås på. En engångsstädning
 * av JSON-filerna hade klarat halva testet och tyst gjort Pro fattigare för
 * alltid.
 */
import { describe, expect, it } from "vitest";
import sv from "../../messages/sv.json";
import en from "../../messages/en.json";
import { withRestockFeatures } from "@/lib/pricing-features";

/** Ord som bara får förekomma i copy som beskriver larm vi FAKTISKT skickar. */
const PROMISES_RESTOCK = /restock|i lager igen|back in stock/i;

/**
 * ⛔ SET-BEVAKNING SÄGER ALDRIG ORDET "RESTOCK" men ÄR inget annat: den skapar
 * restock-larm för setets sealed-produkter och gör noll nytta när larmen är av.
 * Utan det här mönstret hade punkten "Bevaka hela set · larm på alla
 * sealed-produkter" glidit tillbaka in i baslistan och passerat vakten ovan.
 */
const PROMISES_SET_WATCH = /hela set|entire sets/i;

const LOCALES = [
  { name: "sv", m: sv as unknown as Messages },
  { name: "en", m: en as unknown as Messages },
];

interface Messages {
  Pricing: {
    metaDescription: string;
    freeExcluded: string[];
    freeExcludedRestock: string[];
    premiumFeatures: string[];
    premiumRestockFeatures: string[];
    restockPausedNotice: string;
    restockPausedCta: string;
  };
  RestockPause: { banner: string; bannerDiscord: string; discordCta: string; tag: string };
  Watchlist: { freeAlertsBanner: string; subtitle: string };
  Settings: { notifEmailHint: string; notifAllPausedHint: string; planProDesc: string; planFreeDesc: string };
  Watch: { setButtonHintPaused: string; scopeSetPaused: string; scopeItemPaused: string; watchedSetsSubPaused: string };
  Market: { proDesc: string };
  Detail: { alertsProCta: string };
}

describe.each(LOCALES)("$name: paywallen lovar inga pausade larm", ({ m }) => {
  it("ingen Pro-punkt i baslistan nämner restock", () => {
    for (const line of m.Pricing.premiumFeatures) {
      expect(line, `Pro-punkt lovar restock: "${line}"`).not.toMatch(PROMISES_RESTOCK);
      expect(line, `Pro-punkt säljer set-bevakning: "${line}"`).not.toMatch(PROMISES_SET_WATCH);
    }
  });

  it("ingen överstruken gratis-punkt säljer restock", () => {
    // Den överstrukna listan är lika mycket en säljpunkt som Pro-listan: den
    // säger "det här får du om du betalar".
    for (const line of m.Pricing.freeExcluded) {
      expect(line, `Gratis-uteslutning säljer restock: "${line}"`).not.toMatch(PROMISES_RESTOCK);
      expect(line, `Gratis-uteslutning säljer set-bevakning: "${line}"`).not.toMatch(PROMISES_SET_WATCH);
    }
  });

  it("prissidans metabeskrivning nämner inte restock-larm", () => {
    expect(m.Pricing.metaDescription).not.toMatch(PROMISES_RESTOCK);
  });

  it("övriga säljytor lovar inte restock", () => {
    // ⛔ Alla fyra är UPPSÄLJNINGAR mot /priser. En av dem kvar hade räckt:
    // freeAlertsBanner bad uttryckligen gratisanvändaren uppgradera "för att
    // aktivera" pris- OCH restock-larm.
    expect(m.Watchlist.freeAlertsBanner).not.toMatch(PROMISES_RESTOCK);
    expect(m.Watchlist.subtitle).not.toMatch(PROMISES_RESTOCK);
    expect(m.Market.proDesc).not.toMatch(PROMISES_RESTOCK);
    expect(m.Detail.alertsProCta).not.toMatch(PROMISES_RESTOCK);
  });

  it("inställningarnas hintar beskriver bara larm som skickas", () => {
    expect(m.Settings.notifEmailHint).not.toMatch(PROMISES_RESTOCK);
    expect(m.Settings.planProDesc).not.toMatch(PROMISES_RESTOCK);
    expect(m.Settings.planFreeDesc).not.toMatch(PROMISES_RESTOCK);
  });
});

describe.each(LOCALES)("$name: punkterna finns kvar och kommer tillbaka", ({ m }) => {
  it("restock-punkterna är BEVARADE i egna listor, inte raderade", () => {
    // Hela poängen med uppdelningen: prissidan konkatenerar tillbaka dem så fort
    // restockAlertsPaused() blir false. Raderas listorna kommer de aldrig igen.
    expect(m.Pricing.premiumRestockFeatures.length).toBeGreaterThan(0);
    expect(m.Pricing.freeExcludedRestock.length).toBeGreaterThan(0);
    // `some`, inte `every`: set-punkten är restock-beroende utan att säga ordet
    // (se PROMISES_SET_WATCH ovan). Varje rad HÄR ska däremot vara en av de två.
    for (const line of [...m.Pricing.premiumRestockFeatures, ...m.Pricing.freeExcludedRestock]) {
      expect(
        PROMISES_RESTOCK.test(line) || PROMISES_SET_WATCH.test(line),
        `Punkt i restock-listan är varken restock eller set-bevakning: "${line}"`
      ).toBe(true);
    }
  });

  it("pausbeskeden finns på varje yta som annars antytt larm", () => {
    for (const s of [
      m.Pricing.restockPausedNotice,
      m.Pricing.restockPausedCta,
      m.RestockPause.banner,
      m.RestockPause.bannerDiscord,
      m.RestockPause.discordCta,
      m.RestockPause.tag,
      m.Watch.setButtonHintPaused,
      m.Watch.scopeSetPaused,
      m.Watch.scopeItemPaused,
      m.Watch.watchedSetsSubPaused,
      m.Settings.notifAllPausedHint,
    ]) {
      expect(s.trim().length).toBeGreaterThan(0);
    }
  });

  it("pausnotisen på paywallen säger vad som FORTFARANDE gäller", () => {
    // ⛔ Ett bart "pausat" är inte ärligt nog vid köpstället: den som betalar måste se
    // vad de faktiskt får. Notisen pekade förr på PRISLARM som det som ändå fungerar —
    // den raden togs bort 2026-08-26 när prislarmen också pausades (och blev därmed en
    // lögn; vaktat åt andra hållet i price-alert-pause.test.ts). Kvar som "det här
    // gäller ändå" är Discord-kanalen, som till skillnad från prislarmen faktiskt
    // levererar restocks just nu.
    expect(m.Pricing.restockPausedNotice).toMatch(/discord/i);
  });
});

describe.each(LOCALES)("$name: prissidans lista följer flaggan åt BÅDA håll", ({ m }) => {
  it("pausat → exakt baslistan, inget mer", () => {
    expect(withRestockFeatures(m.Pricing.premiumFeatures, m.Pricing.premiumRestockFeatures, true))
      .toEqual(m.Pricing.premiumFeatures);
    expect(withRestockFeatures(m.Pricing.freeExcluded, m.Pricing.freeExcludedRestock, true))
      .toEqual(m.Pricing.freeExcluded);
  });

  it("igång → restock-punkterna är tillbaka, direkt efter bevakningspunkten", () => {
    const pro = withRestockFeatures(m.Pricing.premiumFeatures, m.Pricing.premiumRestockFeatures, false);
    expect(pro).toHaveLength(m.Pricing.premiumFeatures.length + m.Pricing.premiumRestockFeatures.length);
    // Ordningen är inte kosmetik: bevakningspunkten ska stå kvar överst, och
    // restock-punkterna direkt under den — så listan ser ut som före pausen.
    expect(pro[0]).toBe(m.Pricing.premiumFeatures[0]);
    expect(pro.slice(1, 1 + m.Pricing.premiumRestockFeatures.length))
      .toEqual(m.Pricing.premiumRestockFeatures);
    // ⛔ Ingen punkt får tappas bort i skarven.
    for (const line of [...m.Pricing.premiumFeatures, ...m.Pricing.premiumRestockFeatures]) {
      expect(pro).toContain(line);
    }
  });

  it("igång → gratislistans överstrukna punkter är också tillbaka", () => {
    const free = withRestockFeatures(m.Pricing.freeExcluded, m.Pricing.freeExcludedRestock, false);
    for (const line of [...m.Pricing.freeExcluded, ...m.Pricing.freeExcludedRestock]) {
      expect(free).toContain(line);
    }
  });
});

describe("withRestockFeatures: kantfall", () => {
  it("tom baslista tappar inte restock-punkterna", () => {
    expect(withRestockFeatures([], ["a", "b"], false)).toEqual(["a", "b"]);
  });

  it("returnerar en KOPIA, aldrig samma referens som indata", () => {
    // Listorna kommer ur `t.raw()`, dvs den delade meddelandekatalogen. Muteras
    // den av misstag följer felet med varje efterföljande render i processen.
    const base = ["x"];
    expect(withRestockFeatures(base, [], true)).not.toBe(base);
  });
});
