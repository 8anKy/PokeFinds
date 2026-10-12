/**
 * DOLDA SLÄPP VIA LÄNK (Spelexperten 2026-10-12) — src/lib/drop-pages.ts + takten i
 * scripts/lib/drop-watch.ts. Fixturen är ett urklipp ur 30th Celebration Booster Bundle-
 * sidan samma dag ("klickar du på länken nedan där det står 'röd'").
 */
import { describe, expect, it } from "vitest";
import {
  hasPurchaseLimit,
  isRootLevelPage,
  linkTargetPlausible,
  releaseTimeFromTitle,
  shopifyDropLinks,
  spelexpertenDropLinks,
} from "@/lib/drop-pages";
import { linkTargetEveryMs, type LinkTarget } from "../../scripts/lib/drop-watch";

const BASE = "https://www.spelexperten.com";
const SELF = `${BASE}/sallskapsspel/pokemon/pokemon-tcg-30th-celebration-booster-bundle.html`;

const PAGE = `
<nav><a href="/sallskapsspel/pokemon/pokemon-tcg-30th-celebration-mini-tin.html">Meny</a></nav>
<div id="Produktinfo">
  <!-- UTSKRIFT:PRODUKTINFO:START -->
  <div id="read-more-text"><article>
  <p><strong>L&#196;S DETTA F&#214;R ATT KUNNA BEST&#196;LLA!</strong><br /><strong>Denna produkt du just nu &#228;r inne p&#229;
  g&#229;r inte att best&#228;lla. F&#246;r att best&#228;lla klickar du p&#229; l&#228;nken nedan d&#228;r det st&#229;r "r&#246;d"<span>.<br />
  H&#228;r kommer massa text som inte &#228;r <a href="https://www.spelexperten.com/pok-30-12-oktober.html%20">r&#246;d</a> den &#228;r heller inte bl&#229; eller gul.</span></strong></p>
  <p>Denna artikel &#228;r begr&#228;nsad till 1/hush&#229;ll</p>
  </article></div>
  <!-- UTSKRIFT:PRODUKTINFO:STOPP -->
</div>
<footer><a href="/kundservice.html">Kundservice</a></footer>`;

describe("länken i beskrivningen", () => {
  it("hittar den dolda sidan, rensar '%20' och struntar i meny/sidfot", () => {
    expect(spelexpertenDropLinks(PAGE, BASE, SELF)).toEqual([`${BASE}/pok-30-12-oktober.html`]);
  });

  it("relativ länk och 'klicka här'-varianten (Mini Tin)", () => {
    const html = PAGE.replace(
      /<a href="https:\/\/www\.spelexperten\.com\/pok-30-12-oktober\.html%20">/,
      '<a href="/pok-30-12-oktober-1530.html">'
    );
    expect(spelexpertenDropLinks(html, BASE, SELF)).toEqual([`${BASE}/pok-30-12-oktober-1530.html`]);
  });

  it("en sida utan länk i beskrivningen ger inget", () => {
    expect(spelexpertenDropLinks(PAGE.replace(/<a href="https:[^>]+>r&#246;d<\/a>/, "röd"), BASE, SELF)).toEqual([]);
  });

  it("länk till sig själv eller annan domän räknas inte", () => {
    const html = PAGE.replace("https://www.spelexperten.com/pok-30-12-oktober.html%20", SELF).replace(
      "</article>",
      '<a href="https://example.com/x.html">x</a></article>'
    );
    expect(spelexpertenDropLinks(html, BASE, SELF)).toEqual([]);
  });

  it("Shopify: /products/<handle> i beskrivningen", () => {
    const d = '<p>Klicka <a href="/products/hemlig-30th?variant=1">här</a> eller <a href="/collections/all">där</a></p>';
    expect(shopifyDropLinks(d, "https://dragonslair.se", "pokemon-30th-etb")).toEqual(["https://dragonslair.se/products/hemlig-30th"]);
  });

  it("köpgränsen läses ('begränsad till 1/hushåll')", () => {
    expect(hasPurchaseLimit("Denna artikel är begränsad till 1/hushåll")).toBe(true);
    expect(hasPurchaseLimit("Fira 30 år av Pokémon")).toBe(false);
  });
});

describe("är länkmålet den dolda varan?", () => {
  const base = { origPriceOre: 68900, priceOre: 68900, inFeed: false, rootLevel: true, title: "POK 30 12 oktober 15:00" };
  it("samma pris som originalet räcker", () => {
    expect(linkTargetPlausible({ ...base, rootLevel: false, title: "Något" })).toBe(true);
  });
  it("annat pris: bara i roten OCH POK/Pokémon i titeln", () => {
    expect(linkTargetPlausible({ ...base, priceOre: 34900 })).toBe(true);
    expect(linkTargetPlausible({ ...base, priceOre: 34900, title: "Fia med knuff" })).toBe(false);
    expect(linkTargetPlausible({ ...base, priceOre: 34900, rootLevel: false })).toBe(false);
  });
  it("en sida i butikens vanliga feed är aldrig 'dold'", () => {
    expect(linkTargetPlausible({ ...base, inFeed: true })).toBe(false);
  });
  it("rotnivå", () => {
    expect(isRootLevelPage(`${BASE}/pok-30-12-oktober.html`)).toBe(true);
    expect(isRootLevelPage(SELF)).toBe(false);
  });
});

describe("släpptiden ur titeln", () => {
  const morning = Date.parse("2026-10-12T06:00:00Z");
  it("'POK 30 12 oktober 15:30' ⇒ 13:30 UTC (sommartid)", () => {
    expect(releaseTimeFromTitle("POK 30 12 oktober 15:30", morning)).toBe(Date.parse("2026-10-12T13:30:00Z"));
  });
  it("bara klockslag ⇒ i dag; vintertid räknas rätt", () => {
    expect(releaseTimeFromTitle("Släpp 18.00", Date.parse("2026-12-01T08:00:00Z"))).toBe(Date.parse("2026-12-01T17:00:00Z"));
  });
  it("ingen tid ⇒ null ('POK 30' är inget klockslag)", () => {
    expect(releaseTimeFromTitle("POK 30 12 oktober", morning)).toBeNull();
  });
});

describe("länkmålets takt", () => {
  const release = Date.parse("2026-10-12T13:00:00Z");
  const t = (over: Partial<LinkTarget>): LinkTarget => ({
    title: "",
    priceOre: 68900,
    releaseAt: release,
    stock: "OUT_OF_STOCK",
    checkedAt: release - 3 * 3600_000,
    seenAt: release - 5 * 3600_000,
    ...over,
  });
  it("aldrig läst ⇒ nu", () => {
    expect(linkTargetEveryMs(undefined, release, false)).toBe(0);
    expect(linkTargetEveryMs(t({ checkedAt: 0 }), release, false)).toBe(0);
  });
  it("timmar före släppet ⇒ var 5:e min", () => {
    expect(linkTargetEveryMs(t({}), release - 3 * 3600_000, false)).toBe(5 * 60_000);
  });
  it("strax före fönstret ⇒ läses precis när det öppnar", () => {
    const checkedAt = release - 3 * 60_000;
    expect(linkTargetEveryMs(t({ checkedAt }), checkedAt, false)).toBe(90_000);
  });
  it("−90 s … +15 min ⇒ var 5:e s", () => {
    expect(linkTargetEveryMs(t({}), release - 60_000, false)).toBe(5_000);
    expect(linkTargetEveryMs(t({}), release + 10 * 60_000, false)).toBe(5_000);
    expect(linkTargetEveryMs(t({}), release + 20 * 60_000, false)).toBe(30_000);
  });
  it("postad ⇒ var 5:e min", () => {
    expect(linkTargetEveryMs(t({}), release, true)).toBe(5 * 60_000);
  });
  it("utan tid: tätt i 15 min efter att länken dök upp", () => {
    const seenAt = release;
    expect(linkTargetEveryMs(t({ releaseAt: null, seenAt }), seenAt + 60_000, false)).toBe(5_000);
    expect(linkTargetEveryMs(t({ releaseAt: null, seenAt }), seenAt + 3600_000, false)).toBe(30_000);
  });
});
