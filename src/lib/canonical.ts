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

/**
 * ⛔ `||`, ALDRIG `??` (2026-08-17): en variabel kan vara SATT MEN TOM. GitHub Actions
 * expanderar en saknad `${{ vars.X }}` till tom sträng, och `"" ?? reserv` är `""` —
 * reservvärdet används aldrig. Se `tests/unit/env-empty-string-guard.test.ts`, som
 * vaktar hela buggklassen.
 *
 * ⛔ RESERVEN ÄR PRODUKTIONSDOMÄNEN, INTE LOCALHOST. En `<link rel="canonical"
 * href="http://localhost:3000/produkter">` i drift är TYST SJÄLVAVINDEXERING: vi säger
 * själva att sidan egentligen bor på en adress ingen crawler kan nå, och Google följer
 * vår egen signal — samma familj av fel som marcustheatres-klustringen ovan, fast
 * självförvållad. Inget felar, inget larmar; trafiken bara upphör. Samma reservvärde
 * som `src/services/notifications.ts` (djuplänkarna i larmen).
 */
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://foilio.se";

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

/**
 * Sajtens delningsbild. RELATIV med flit — Next absolutiserar mot `metadataBase`
 * (satt i rot-layouten), så bilden följer med av sig själv nästa gång värdnamnet byts.
 *
 * ⚠️ Det här är märket (1024×1024), inte ett ändamålsbyggt 1200×630-kort: en sådan
 * bild är en DESIGNLEVERANS som inte finns ännu. Kvadraten visas rakt av i Discord,
 * Slack och iMessage; X beskär den till 2:1. En beskuren logga slår en TOM
 * förhandsvisning, men byt hit `/brand/foilio-og.png` så fort kortet är ritat.
 */
const OG_IMAGE = "/brand/foilio-mark.png";

/**
 * Bas-fälten för `openGraph`. Spreadas av VARJE sida som sätter ett eget
 * openGraph-block: `openGraph: { ...baseOpenGraph(locale), title, description, images }`.
 *
 * ⛔ NEXTS METADATA-MERGE ÄR GRUND PER TOPPFÄLT (2026-08-17). En sida som sätter
 * `openGraph` ERSÄTTER rot-layoutens hela objekt — den slås inte ihop fält för fält.
 * Produktsidan satte redan `{ title, description, images }` och tappade därmed
 * `og:site_name`, `og:type` och `og:locale` på sajtens ~20k mest delade URL:er, utan
 * att något felar eller syns i appen. Därför en DELAD funktion i stället för en literal
 * som kopieras vidare: nästa sida som lägger till ett openGraph-block ärver rätt bas
 * även om ingen kommer ihåg varför.
 *
 * ⚠️ `images: undefined` ÖVERSKRIVER basbilden — ett utskrivet fält vinner över
 * spreaden även när värdet är undefined. Har sidan ingen egen bild ska nyckeln
 * UTELÄMNAS (eller falla tillbaka på `baseOpenGraph(locale).images`), annars delas
 * sidan helt utan förhandsvisning.
 *
 * `locale` mappas här och inte via meddelandekatalogen: `og:locale` är en språkKOD
 * (`sv_SE`/`en_US`), inte copy — den ska aldrig översättas, och funktionen måste vara
 * synkron för att kunna anropas från vilken `generateMetadata` som helst.
 */
export function baseOpenGraph(locale: string) {
  return {
    type: "website" as const,
    siteName: "Foilio",
    locale: locale === "en" ? "en_US" : "sv_SE",
    images: [{ url: OG_IMAGE, width: 1024, height: 1024, alt: "Foilio" }],
  };
}
