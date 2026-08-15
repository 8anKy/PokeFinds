import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ÄGARENS KATALOGBORTTAGNING (`Product.hiddenAt`, 2026-08-15).
 *
 * Ägaren ville ta bort ~145 produkter ur katalogen men BEHÅLLA dem i Discord-lanens
 * restock-inlägg. Det går inte med en radering: ruttabellen (butiks-URL → produkt)
 * byggs ur Offer + StoreListing, så en raderad produkt gör att lanen ser lagerflippen
 * men inte kan posta den ("okänd URL") — tyst, och permanent, eftersom raderingsflödet
 * dessutom denylistar butiks-URL:erna. Lösningen är att GÖMMA raden.
 *
 * ⛔ DÄRFÖR ÄR "GÖMD" INTE ETT TILLSTÅND UTAN EN UPPRÄKNING AV YTOR. Varje publik
 *    lista måste filtrera själv; missas en är produkten kvar i katalogen och hela
 *    poängen med borttagningen är borta — utan att något felar. Det här testet är
 *    listan över ytor, och den ska växa när en ny publik lista tillkommer.
 *
 * ⛔ PRODUKTSIDAN SKA INTE FILTRERA. `/produkter/[slug]` måste svara på en direkt
 *    träff, annars pekar varje Discord-embed på en 404 — dvs precis det utfall
 *    gömningen finns för att undvika. Testet vaktar det åt andra hållet.
 *
 * Källfilerna läses som TEXT: en riktig import hade dragit in halva Next-appen
 * (Prisma, auth, i18n) för att kontrollera en handfull rader — samma avvägning som
 * admin-sort-gate-sync.test.ts och cron-chain-sync.test.ts.
 */
const SRC = resolve(__dirname, "../../src");
const read = (p: string) => readFileSync(resolve(SRC, p), "utf8");

/** Ytor som MÅSTE filtrera bort gömda produkter, och vad som utgör beviset. */
const GUARDED: { file: string; what: string; needle: RegExp }[] = [
  {
    file: "services/products.ts",
    what: "katalog + sök (buildProductWhere)",
    needle: /where\.hiddenAt = null/,
  },
  {
    file: "services/products.ts",
    what: "kompaktsökningens id-lista (rå SQL i en OR-gren)",
    needle: /NOT_HIDDEN_SQL/,
  },
  {
    file: "services/products.ts",
    what: "fuzzy-reserven (rå SQL)",
    needle: /"hiddenAt" IS NULL/,
  },
  {
    file: "services/explore-facets.ts",
    what: "filtrens facettsiffror",
    needle: /p\."hiddenAt" IS NULL/,
  },
  {
    file: "app/api/search/suggest/route.ts",
    what: "sök-autocomplete",
    needle: /NOT_HIDDEN/,
  },
  {
    file: "app/sitemap.ts",
    what: "sitemapen (crawlers)",
    needle: /NOT_HIDDEN/,
  },
  {
    file: "services/market.ts",
    what: "/marknad — trending, prisras, mest bevakade, set-index",
    needle: /NOT_HIDDEN/,
  },
];

describe("Product.hiddenAt — gömda produkter försvinner ur alla publika listor", () => {
  for (const { file, what, needle } of GUARDED) {
    it(`${what} filtrerar på hiddenAt (${file})`, () => {
      expect(read(file)).toMatch(needle);
    });
  }

  it("liknande produkter filtrerar i BÅDA grenarna — även sista utvägen", () => {
    const src = read("services/products.ts");
    // Nivå 1-3 delar `priced`; sista utvägen spridar den INTE och är därför den
    // gren en gömd produkt kommer tillbaka genom om filtret bara läggs på `priced`.
    expect(src).toMatch(/const priced = \{ lowestPriceOre: \{ not: null \}, \.\.\.NOT_HIDDEN \}/);
    expect(src).toMatch(/where: \{ category: product\.category, \.\.\.NOT_HIDDEN, id: \{ notIn/);
  });

  it("restock-larm (mejl/push) tystnar för gömda produkter", () => {
    const src = read("scrapers/runner.ts");
    expect(src).toMatch(/function isHiddenFromAlerts/);
    // ⛔ LÖS jämförelse, med flit. Strikt `!== null` gör ett SAKNAT fält (undefined)
    //    till "gömd" ⇒ varje restock-larm tystnar tyst. Riktningen ska vara ett larm
    //    för mycket, aldrig noll.
    expect(src).toMatch(/product\.hiddenAt != null \|\| HIDDEN_CATEGORIES\.includes/);
    expect(src).not.toMatch(/product\.hiddenAt !== null/);
    // BÅDA larmvägarna: feed-diffen och frånvaro-verifieringen.
    expect(src.match(/const hidden = isHiddenFromAlerts\(/g) ?? []).toHaveLength(2);
    // ...och kolumnen måste faktiskt hämtas, annars är grinden alltid falsk.
    expect(src).toMatch(/product: \{ select: \{ category: true, hiddenAt: true \} \}/);
  });

  it("DISCORD-LANEN RÖRS INTE — ruttabellen har inget gömfilter", () => {
    // ⛔ Hela poängen. Lägger någon till ett hiddenAt-filter i exporten försvinner
    //    inläggen som gömningen fanns till för att BEHÅLLA, och symptomet är tyst:
    //    "okänd URL" i loggen, inget fel, inget larm.
    const src = readFileSync(resolve(__dirname, "../../scripts/lib/restock-routes.ts"), "utf8");
    expect(src).not.toMatch(/hiddenAt/);
  });

  it("produktsidan grindar INTE på hiddenAt (Discord-embedden länkar dit)", () => {
    const page = read("app/[locale]/(marketing)/produkter/[slug]/page.tsx");
    expect(page).not.toMatch(/hiddenAt/);
  });
});
