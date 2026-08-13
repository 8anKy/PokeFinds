import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADMIN-ONLY SORTERINGAR (2026-08-13). "Nyligen tillagd" finns för att kunna granska
 * vad en ny butiksvåg drog in i katalogen — wave 5 skapade 898 produkter på en natt,
 * varav 118 aldrig skulle ha kommit in. Den är driftvy, inte produktfunktion: en
 * besökare bryr sig om vad varan kostar, inte om vilken natt raden skapades.
 *
 * ⛔ GRINDEN MÅSTE SITTA PÅ TRE STÄLLEN OCH ALLA TRE BEHÖVS:
 *    1. Menyn i /produkter (alternativet renderas aldrig för någon annan),
 *    2. sorteringsUPPSLAGET i samma fil — `?sortera=nyligen-tillagd` går att gissa
 *       och länken kan delas vidare, så "dölj alternativet" är inget skydd,
 *    3. feed-routen, som levererar ALLT utom första sidan (infinite scroll).
 *    Punkt 3 är den man tar bort för att den ser redundant ut — precis som
 *    Discord-avstämningen. Utan den räcker det att scrolla en sida för att komma förbi.
 *
 * ⛔ OCH DEN GRINDADE FEEDEN FÅR ALDRIG I DEN DELADE CACHEN: CDN:en nycklar på URL:en,
 *    så adminens riktiga svar och den tomma listan hade delat post.
 *
 * Testet läser källfilerna som TEXT. En riktig import hade dragit in halva Next-appen
 * (sidan är en server-komponent med auth, i18n och Prisma i importkedjan) för att
 * kontrollera fyra rader — samma avvägning som cron-chain-sync.test.ts gör.
 */
const SRC = resolve(__dirname, "../../src");
const read = (p: string) => readFileSync(resolve(SRC, p), "utf8");

const PAGE = read("app/[locale]/(marketing)/produkter/page.tsx");
const FEED = read("app/api/products/feed/route.ts");
const SERVICE = read("services/products.ts");

/** Sorteringsvärdena som är märkta adminOnly i katalogens SORT_OPTIONS. */
function adminOnlySorts(): string[] {
  const out: string[] = [];
  for (const m of PAGE.matchAll(/\{\s*value:\s*"[^"]+",\s*key:\s*"[^"]+",\s*sort:\s*"([^"]+)",\s*adminOnly:\s*true\s*\}/g)) {
    out.push(m[1]);
  }
  return out;
}

describe("admin-only sorteringar är grindade överallt", () => {
  it("katalogen har minst en adminOnly-sortering, och den är recently_added", () => {
    // Failar den här har någon tagit bort märkningen — resten av testet blir då
    // tomt och skulle passera utan att kontrollera något alls.
    expect(adminOnlySorts()).toContain("recently_added");
  });

  it("sorteringsuppslaget i /produkter kräver rollen, inte bara menyn", () => {
    // Uppslaget måste filtrera på adminOnly — annars gäller ?sortera=... för alla.
    expect(PAGE).toMatch(/SORT_OPTIONS\.find\(\(o\) =>[\s\S]{0,120}adminOnly[\s\S]{0,20}isAdmin/);
    // Och menyn byggs ur den filtrerade listan, inte ur SORT_OPTIONS rakt av.
    expect(PAGE).toMatch(/visibleSortOptions\s*=\s*SORT_OPTIONS\.filter\(\(o\) => !o\.adminOnly \|\| isAdmin\)/);
    expect(PAGE).toMatch(/sortOptionList\s*=\s*visibleSortOptions\.map/);
  });

  it("feed-routen känner varje adminOnly-sortering och tömmer svaret utan rollen", () => {
    for (const sort of adminOnlySorts()) {
      expect(FEED, `feed-routen måste grinda "${sort}"`).toContain(`params.sort === "${sort}"`);
      // Sorteringen måste också vara ett giltigt värde i schemat — annars 400 för admin.
      expect(FEED, `"${sort}" saknas i feed-schemat`).toContain(`"${sort}"`);
    }
    expect(FEED).toMatch(/if \(adminOnly && !isAdmin\)[\s\S]{0,120}items: \[\]/);
    expect(FEED).toMatch(/role === "ADMIN" \|\| role === "SUPERADMIN"/);
  });

  it("det grindade svaret går aldrig i den delade CDN-cachen", () => {
    // jsonCached() nycklar på URL:en. Hamnar admin-svaret där får nästa besökare det.
    expect(FEED).toMatch(/return userId \|\| adminOnly \? Response\.json\(result\) : jsonCached/);
  });

  it("recently_added ordnar på createdAt — aldrig updatedAt", () => {
    // updatedAt rörs av varje prisuppdatering. "Nyligen tillagd" hade då blivit
    // "nyligen prisändrad", dvs hela katalogen i praktiskt taget slumpmässig ordning,
    // och felet syns inte förrän man jämför mot databasen.
    expect(SERVICE).toMatch(/case "recently_added": return \{ createdAt: "desc" \}/);
  });

  it("recently_added är DB-sorterad så scrollen når hela katalogen", () => {
    // Den beräknade vägen tar bara MAX_CANDIDATES rader, valda på updatedAt — alltså
    // exakt fel urval för den här frågan.
    const dbSortable = SERVICE.slice(SERVICE.indexOf("const DB_SORTABLE"), SERVICE.indexOf("const DB_SORTABLE") + 1200);
    for (const sort of adminOnlySorts()) {
      expect(dbSortable, `"${sort}" måste vara DB-sorterbar`).toContain(`"${sort}"`);
    }
  });

  it("alternativet är översatt på båda språken", () => {
    for (const lang of ["sv", "en"]) {
      const messages = JSON.parse(readFileSync(resolve(SRC, `../messages/${lang}.json`), "utf8")) as {
        Products: { sort: Record<string, string> };
      };
      // Nyckeln är `key`-fältet i SORT_OPTIONS; för adminsorteringen är den samma
      // som sort-värdet. Saknas den kastar next-intl i produktion.
      expect(messages.Products.sort.recently_added, `${lang}.json`).toBeTruthy();
    }
  });
});
