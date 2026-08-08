import type { Metadata } from "next";
import { routing } from "@/i18n/routing";

/**
 * Kanonisk URL + hreflang-alternativ för en publik sida.
 *
 * ⛔ VARFÖR FILEN FINNS (2026-08-08): sajten deklarerade INGEN kanonisk URL alls.
 * Följden syntes först när Search Console kopplades på: /produkter rapporterades
 * som "Duplicate without user-selected canonical", och Googles EGET val av
 * kanonisk URL för vår sida var `https://www.marcustheatres.com/` — en amerikansk
 * biografkedja. Sidan var crawlad utan fel ("Crawl allowed: Yes", "Page fetch:
 * Successful", "Indexing allowed: Yes") och hade både titel och beskrivning; det
 * enda som saknades var vår egen signal om vilken URL som ÄR sidan. Utan den
 * klustrar Google fritt, och en sida vars kanoniska URL pekar på någon ANNANS
 * domän blir aldrig indexerad — dvs den kan inte hittas på Google alls.
 *
 * ⛔ EN DEFINITION, inte en sträng per sida: sv ligger på rot (`/produkter`) och en
 * på prefix (`/en/produkter`) eftersom `localePrefix` är "as-needed". Skrivs den
 * regeln av för hand i tolv `generateMetadata` glider en av dem förr eller senare,
 * och en FELAKTIG kanonisk URL är värre än ingen: den pekar aktivt bort
 * indexeringen från sidan.
 *
 * ⛔ ANROPAS FRÅN SIDAN, aldrig från layouten. Rot-layouten vet inte vilken väg som
 * renderas (`headers()` hade avslöjat den, men gör HELA appen dynamisk och river
 * ISR-cachen — se "Caching/ISR" i CLAUDE.md). En kanonisk URL satt i layouten hade
 * dessutom blivit SAMMA för varje sida, vilket är exakt det fel vi lagar.
 */

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/**
 * Absolut URL för `path` på ett givet språk. `path` anges UTAN språkprefix
 * ("/produkter", "/sets/sv1") — prefixet läggs på här enligt routing-reglerna.
 */
export function localeUrl(locale: string, path: string): string {
  const clean = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  // Roten på standardspråket ger tomt prefix OCH tom väg, alltså bara origin utan
  // avslutande slash. Skriv den som `/` — en kanonisk URL ska vara en VÄG.
  if (prefix === "" && clean === "") return `${BASE_URL}/`;
  return `${BASE_URL}${prefix}${clean}`;
}

/**
 * `alternates`-blocket för en sida: kanonisk URL för det språk som renderas, plus
 * hreflang för båda språken. `x-default` pekar på svenska — sajten är svensk, och
 * utan den väljer Google själv vilken språkversion som visas för okända marknader.
 */
export function alternatesFor(locale: string, path: string): Metadata["alternates"] {
  return {
    canonical: localeUrl(locale, path),
    languages: {
      sv: localeUrl("sv", path),
      en: localeUrl("en", path),
      "x-default": localeUrl(routing.defaultLocale, path),
    },
  };
}
