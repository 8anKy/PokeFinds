import { redirect } from "@/i18n/navigation";

/**
 * ⛔ MÅSTE VARA DYNAMISK. `redirect()` kastar `NEXT_REDIRECT`, och i en STATISKT
 * prerenderad route (routen var `● SSG`) fångas det som ett renderingsfel: Next
 * byggde en felsida (`<html id="__next_error__">`, 85 kB) och serverade den med
 * status 307 men UTAN `Location`-header. Alltså en trasig omdirigering som såg
 * grön ut i bygget — verifierat mot en körande server, inte gissat.
 *
 * Kostar ingenting att göra dynamisk: sidan gör noll DB-arbete, så den väcker
 * inte Neon. Den renderar aldrig något — den svarar bara 307 + Location.
 */
export const dynamic = "force-dynamic";

/**
 * Startsidan ÄR Utforska (ägarbeslut 2026-08-06).
 *
 * Marknadsförings-startsidan är borttagen: den som söker upp foilio.se ska mötas
 * av katalogen, inte av en "gå med"-pitch. Native-appen gjorde redan precis det —
 * `NativeHomeRedirect` skickade Capacitor-användare vidare till /produkter med
 * motiveringen "app-användare ska inte mötas av en pitch". Webben gör nu samma sak,
 * och den komponenten är därmed borttagen: en gren mindre att hålla i synk.
 *
 * ⛔ TEMPORÄR (307), INTE PERMANENT (308). En permanent omdirigering cachas hårt av
 * webbläsaren, och den dagen någon vill ha tillbaka en startsida skulle alla
 * återvändande besökare fortsätta studsa till /produkter tills de rensar cachen.
 * Google följer 307 utan problem; det som förloras är lite länkkraft-konsolidering,
 * och det är ett billigare pris än ett beslut som inte går att ångra.
 *
 * ⛔ SPRÅKET SKÖTS AV MIDDLEWARE, inte här. next-intl (`localePrefix: "as-needed"`,
 * locale-detektering på) skickar en besökare med `NEXT_LOCALE=en` från `/` till
 * `/en` INNAN den här filen körs, så `redirect` ur `@/i18n/navigation` ärver rätt
 * locale och landar på `/en/produkter`. Det var exakt det NativeHomeRedirect läste
 * cookien manuellt för att lösa när omdirigeringen låg i klienten.
 *
 * ⚠️ Marknadsförings-copyn ligger KVAR i messages/*.json (namnrymden `Home`). Den
 * är inte död vikt av misstag: `tests/unit/watchlist-limit-copy-sync.test.ts` läser
 * startsidans FAQ för att vakta att bevakningstaket står likadant överallt, och
 * texterna behövs den dag en riktig landningssida byggs. Radera dem inte utan att
 * läsa det testet först.
 */
export default function HomePage({ params }: { params: { locale: string } }) {
  // Locale måste skickas med explicit — next-intls `redirect` härleder den inte ur
  // request-kontexten. Middleware har redan valt rätt locale åt oss (se ovan), så
  // den som kommer hit via `/en` fortsätter till `/en/produkter`.
  redirect({ href: "/produkter", locale: params.locale });
}
