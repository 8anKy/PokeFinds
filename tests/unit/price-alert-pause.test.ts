/**
 * Vaktar prislarms-pausen (2026-08-26) — grinden OCH copyn.
 *
 * VARFÖR PAUSEN FINNS: tre olagade defekter, alla mätta i prod samma dag.
 *  1. Larmet kollar varken lagerstatus, direktlänk eller källa på offern som utlöste
 *     det. Ett mätt larm ("nu 1 338,00 kr") kom från en OUT_OF_STOCK-offer på en
 *     produkt vars verkliga lägsta pris var 2 665,55 kr.
 *  2. Ingen cooldown alls — samma produkt+användare larmade 7 gånger på 30 dygn.
 *  3. Mejlet visar priset ur billigaste offer VID UTSKICKET, inte det som utlöste
 *     larmet (mätt: 459 kr i larmraden, 354,56 kr i mejlrubriken).
 *
 * ⛔ TESTET ÄR TVÅSIDIGT, precis som restock-pausens. Det räcker inte att punkterna
 * FÖRSVINNER när larmen är av — de måste KOMMA TILLBAKA när flaggan slås om. En
 * engångsstädning av JSON-filerna hade klarat halva testet och tyst gjort Pro
 * fattigare för alltid. Det var exakt den fällan restock-pausen gick i.
 */
import { afterEach, describe, expect, it } from "vitest";
import sv from "../../messages/sv.json";
import en from "../../messages/en.json";
import { pausableFeatures } from "@/lib/pricing-features";
import { priceAlertsPaused, priceAlertsPausedClient } from "@/lib/price-alerts-pause";
import { alertCopyKey } from "@/lib/alert-copy";

/** Ord som bara får stå i copy som beskriver larm vi FAKTISKT skickar. */
const PROMISES_PRICE_ALERT = /prislarm|price alert/i;

interface Messages {
  Pricing: {
    freeExcluded: string[];
    freeExcludedPrice: string[];
    freeExcludedRestock: string[];
    premiumFeatures: string[];
    premiumPriceFeatures: string[];
    premiumRestockFeatures: string[];
    priceAlertsPausedNotice: string;
    restockPausedNotice: string;
  };
  RestockPause: { banner: string; bannerPrice: string; bannerBoth: string };
  Settings: {
    notifEmailHint: string;
    notifEmailHintPaused: string;
    planProDesc: string;
    planProDescPaused: string;
    planFreeDesc: string;
    planFreeDescPaused: string;
  };
  Watchlist: {
    subtitle: string;
    subtitlePaused: string;
    editHint: string;
    editHintPaused: string;
    freeAlertsBanner: string;
    freeAlertsBannerPaused: string;
  };
  Market: { proDesc: string; proDescPaused: string };
  Detail: { alertsProCta: string; alertsProCtaPaused: string; priceModalIntro: string; priceModalIntroPaused: string };
}

/**
 * Varje yta som lovade prislarm i löpande text, med sin pausade motsvarighet.
 * ⛔ ALLA NIO ÄR SÄLJTEXTER, ett reglage eller ett löfte vid själva inställningsmomentet.
 * Lämnas EN kvar räcker det:
 * `freeAlertsBanner` bad uttryckligen gratisanvändaren betala "för att aktivera" larm
 * som är avstängda — exakt anspråket som kostade pengar under restock-pausen.
 */
const SURFACES: { ns: keyof Messages; key: string }[] = [
  { ns: "Settings", key: "notifEmailHint" },
  { ns: "Settings", key: "planProDesc" },
  { ns: "Settings", key: "planFreeDesc" },
  { ns: "Watchlist", key: "subtitle" },
  { ns: "Watchlist", key: "freeAlertsBanner" },
  { ns: "Market", key: "proDesc" },
  { ns: "Detail", key: "alertsProCta" },
  { ns: "Detail", key: "priceModalIntro" },
  { ns: "Watchlist", key: "editHint" },
];

const LOCALES = [
  { name: "sv", m: sv as unknown as Messages },
  { name: "en", m: en as unknown as Messages },
];

describe("priceAlertsPaused: grinden", () => {
  const before = { server: process.env.PRICE_ALERTS_PAUSED, client: process.env.NEXT_PUBLIC_PRICE_ALERTS_PAUSED };
  afterEach(() => {
    process.env.PRICE_ALERTS_PAUSED = before.server;
    process.env.NEXT_PUBLIC_PRICE_ALERTS_PAUSED = before.client;
  });

  it("defaultar till PAUSAT när variabeln saknas", () => {
    // Fail-safe åt rätt håll: ett gränssnitt som underdriver är irriterande, ett som
    // lovar en betalande kund larm som aldrig kommer är en lögn.
    delete process.env.PRICE_ALERTS_PAUSED;
    delete process.env.NEXT_PUBLIC_PRICE_ALERTS_PAUSED;
    expect(priceAlertsPaused()).toBe(true);
    expect(priceAlertsPausedClient()).toBe(true);
  });

  it("bara exakt \"0\" slår på larmen igen", () => {
    for (const v of ["1", "", "true", "false", "no", "PAUSED"]) {
      process.env.PRICE_ALERTS_PAUSED = v;
      expect(priceAlertsPaused(), `"${v}" ska läsas som PAUSAT`).toBe(true);
    }
    process.env.PRICE_ALERTS_PAUSED = "0";
    expect(priceAlertsPaused()).toBe(false);
  });

  it("läses vid ANROPET, inte vid modulladdning", () => {
    // Annars kan varken tester eller engångsskript sätta flaggan utan att bry sig om
    // importordningen — samma krav som restockAlertsPaused().
    process.env.PRICE_ALERTS_PAUSED = "0";
    expect(priceAlertsPaused()).toBe(false);
    process.env.PRICE_ALERTS_PAUSED = "1";
    expect(priceAlertsPaused()).toBe(true);
  });

  it("server och klient har SAMMA default — aldrig en påslagen och en avstängd", () => {
    delete process.env.PRICE_ALERTS_PAUSED;
    delete process.env.NEXT_PUBLIC_PRICE_ALERTS_PAUSED;
    expect(priceAlertsPaused()).toBe(priceAlertsPausedClient());
  });
});

describe.each(LOCALES)("$name: paywallen säljer inga pausade prislarm", ({ m }) => {
  it("ingen Pro-punkt i baslistan nämner prislarm", () => {
    for (const line of m.Pricing.premiumFeatures) {
      expect(line, `Pro-punkt lovar prislarm: "${line}"`).not.toMatch(PROMISES_PRICE_ALERT);
    }
  });

  it("ingen överstruken gratis-punkt säljer prislarm", () => {
    // Den överstrukna listan är lika mycket en säljpunkt som Pro-listan: den säger
    // "det här får du om du betalar".
    for (const line of m.Pricing.freeExcluded) {
      expect(line, `Gratis-uteslutning säljer prislarm: "${line}"`).not.toMatch(PROMISES_PRICE_ALERT);
    }
  });

  it("restock-notisen påstår INTE längre att prislarm fungerar som vanligt", () => {
    // ⛔ REGRESSIONEN SOM GAV RADEN: notisen sa ordagrant "Prislarm fungerar som
    // vanligt" — sant fram till 2026-08-26, en lögn efter. En pausnotis som ljuger om
    // grannfunktionen är värre än ingen notis alls.
    expect(m.Pricing.restockPausedNotice).not.toMatch(PROMISES_PRICE_ALERT);
    expect(m.RestockPause.banner).not.toMatch(PROMISES_PRICE_ALERT);
  });

  it.each(SURFACES)("$ns.$key har en pausad variant som INTE lovar prislarm", ({ ns, key }) => {
    const group = m[ns] as unknown as Record<string, string>;
    const paused = group[`${key}Paused`];
    expect(paused, `${ns}.${key}Paused saknas`).toBeTypeOf("string");
    expect(paused.trim().length).toBeGreaterThan(0);
    // ⛔ REGELN ÄR "LOVA INTE", INTE "NÄMN INTE". En text får säga ordet prislarm —
    // men bara för att berätta att de ÄR pausade. `notifEmailHintPaused` beskriver en
    // kryssruta som fortfarande gör något (veckobrev, kontomejl) och måste kunna säga
    // vad den INTE längre gör. En text som nämner larmen utan att säga "pausade" är
    // däremot ett löfte, oavsett hur den är formulerad.
    if (PROMISES_PRICE_ALERT.test(paused)) {
      expect(paused, `Nämner prislarm utan att säga att de är pausade: "${paused}"`)
        .toMatch(/pausad|paused/i);
    }
  });

  it.each(SURFACES)("$ns.$key BEHÅLLER originaltexten (annars kommer den aldrig igen)", ({ ns, key }) => {
    // ⛔ Skillnaden mot restock-pausen, som RADERADE ordet ur sju strängar: här ligger
    // originalet kvar under sin egen nyckel, så det räcker att flippa flaggan. Faller
    // det här testet har någon "städat" och gjort pausen enkelriktad.
    const group = m[ns] as unknown as Record<string, string>;
    expect(group[key].trim().length).toBeGreaterThan(0);
    expect(group[key]).not.toBe(group[`${key}Paused`]);
  });

  it("det finns ett eget besked för prislarmspausen", () => {
    expect(m.Pricing.priceAlertsPausedNotice.trim().length).toBeGreaterThan(0);
    expect(m.Pricing.priceAlertsPausedNotice).toMatch(PROMISES_PRICE_ALERT);
    // Alla tre banderolltexterna måste finnas: restock, prislarm och båda. Saknas
    // "båda" faller gränssnittet tillbaka på ett besked som bara halva sanningen.
    for (const s of [m.RestockPause.bannerPrice, m.RestockPause.bannerBoth]) {
      expect(s.trim().length).toBeGreaterThan(0);
    }
    expect(m.RestockPause.bannerBoth).toMatch(PROMISES_PRICE_ALERT);
  });
});

describe.each(LOCALES)("$name: punkterna är bevarade och kommer tillbaka", ({ m }) => {
  it("prispunkterna ligger i egna listor, inte raderade", () => {
    expect(m.Pricing.premiumPriceFeatures.length).toBeGreaterThan(0);
    expect(m.Pricing.freeExcludedPrice.length).toBeGreaterThan(0);
    for (const line of [...m.Pricing.premiumPriceFeatures, ...m.Pricing.freeExcludedPrice]) {
      expect(line, `Punkt i prislistan handlar inte om prislarm: "${line}"`).toMatch(PROMISES_PRICE_ALERT);
    }
  });

  it("båda pausade → exakt baslistan, inget mer", () => {
    const groups = (paused: boolean) => [
      { items: m.Pricing.premiumPriceFeatures, paused },
      { items: m.Pricing.premiumRestockFeatures, paused },
    ];
    expect(pausableFeatures(m.Pricing.premiumFeatures, groups(true))).toEqual(m.Pricing.premiumFeatures);
  });

  it("prislarm på, restock kvar pausat → bara prispunkterna tillbaka", () => {
    // Det HÄR är det troliga nästa läget: defekterna lagas medan restock fortfarande
    // väntar på kostnad. Listan måste kunna gå halvvägs.
    const out = pausableFeatures(m.Pricing.premiumFeatures, [
      { items: m.Pricing.premiumPriceFeatures, paused: false },
      { items: m.Pricing.premiumRestockFeatures, paused: true },
    ]);
    expect(out).toHaveLength(m.Pricing.premiumFeatures.length + m.Pricing.premiumPriceFeatures.length);
    expect(out[0]).toBe(m.Pricing.premiumFeatures[0]);
    expect(out.slice(1, 1 + m.Pricing.premiumPriceFeatures.length)).toEqual(m.Pricing.premiumPriceFeatures);
    for (const line of m.Pricing.premiumRestockFeatures) expect(out).not.toContain(line);
  });

  it("båda igång → varje punkt är tillbaka, prispunkterna före restock", () => {
    const out = pausableFeatures(m.Pricing.premiumFeatures, [
      { items: m.Pricing.premiumPriceFeatures, paused: false },
      { items: m.Pricing.premiumRestockFeatures, paused: false },
    ]);
    expect(out).toHaveLength(
      m.Pricing.premiumFeatures.length +
        m.Pricing.premiumPriceFeatures.length +
        m.Pricing.premiumRestockFeatures.length
    );
    for (const line of [
      ...m.Pricing.premiumFeatures,
      ...m.Pricing.premiumPriceFeatures,
      ...m.Pricing.premiumRestockFeatures,
    ]) {
      expect(out).toContain(line);
    }
    // Ordningen är inte kosmetik: bevakningspunkten överst, sedan prislarmet, sedan
    // restock — så listan läser som före de två pauserna.
    expect(out.indexOf(m.Pricing.premiumPriceFeatures[0]))
      .toBeLessThan(out.indexOf(m.Pricing.premiumRestockFeatures[0]));
  });

  it("gratislistans överstrukna punkter följer samma flaggor", () => {
    const out = pausableFeatures(m.Pricing.freeExcluded, [
      { items: m.Pricing.freeExcludedPrice, paused: false },
      { items: m.Pricing.freeExcludedRestock, paused: false },
    ]);
    for (const line of [
      ...m.Pricing.freeExcluded,
      ...m.Pricing.freeExcludedPrice,
      ...m.Pricing.freeExcludedRestock,
    ]) {
      expect(out).toContain(line);
    }
  });

  it("ingen punkt står i TVÅ listor (annars dubbleras den när flaggan slås om)", () => {
    const all = [
      ...m.Pricing.premiumFeatures,
      ...m.Pricing.premiumPriceFeatures,
      ...m.Pricing.premiumRestockFeatures,
    ];
    expect(new Set(all).size).toBe(all.length);
    const free = [...m.Pricing.freeExcluded, ...m.Pricing.freeExcludedPrice, ...m.Pricing.freeExcludedRestock];
    expect(new Set(free).size).toBe(free.length);
  });
});

describe("pausableFeatures: kantfall", () => {
  it("tom baslista tappar inte punkterna", () => {
    expect(pausableFeatures([], [{ items: ["a"], paused: false }, { items: ["b"], paused: false }]))
      .toEqual(["a", "b"]);
  });

  it("returnerar en KOPIA, aldrig samma referens som indata", () => {
    // Listorna kommer ur `t.raw()`, dvs den delade meddelandekatalogen. Muteras den av
    // misstag följer felet med varje efterföljande render i processen.
    const base = ["x"];
    expect(pausableFeatures(base, [{ items: [], paused: true }])).not.toBe(base);
  });

  it("inga grupper alls = baslistan oförändrad", () => {
    expect(pausableFeatures(["x", "y"], [])).toEqual(["x", "y"]);
  });
});

describe("alertCopyKey", () => {
  it("pausat → <namn>Paused, igång → originalnyckeln", () => {
    expect(alertCopyKey("subtitle", true)).toBe("subtitlePaused");
    expect(alertCopyKey("subtitle", false)).toBe("subtitle");
  });
});
