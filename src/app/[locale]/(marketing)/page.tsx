import { permanentRedirect } from "@/i18n/navigation";

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
 * ⛔ PERMANENT (308) SEDAN 2026-08-11 — var 307, och den gamla motiveringen
 * ("det som förloras är lite länkkraft-konsolidering") var MÄTBART FEL. En
 * temporär omdirigering säger åt Google att `/` fortfarande är sin egen URL, så
 * signalerna konsolideras ALDRIG in i målet: Google får ingen post för
 * foilio.se och kan inte peka ut någon startsida för varumärket. Utfallet i
 * produktion (inkognitosökning på "www.foilio.se", 2026-08-11):
 *   · ingen samlad träff med sitelinks — bara en platt lista av lösa sidor,
 *   · ÖVERST låg `/logga-in`, som ärver `Meta.title`/`Meta.description` ordagrant
 *     och därmed utgav sig för att VARA startsidan (nu noindex, se (auth)/layout),
 *   · Googles AI-översikt påstod rakt ut att "Adressen www.foilio.se leder inte
 *     till en aktiv svensk webbplats".
 * Med 308 ärver /produkter rotens varumärkessignaler och blir sajtens ingång.
 *
 * ⚠️ Priset är det som 307 valdes för att slippa: 308 cachas hårt av webbläsaren.
 * Ska en riktig startsida tillbaka räcker det inte att ändra koden — återvändande
 * besökare studsar vidare tills cachen rensas. Bind i så fall svaret med en
 * `Cache-Control: max-age=…` på rutten INNAN 308:an går ut, så fönstret är känt.
 *
 * ⛔ Sitelinks (de indragna undersidorna i en varumärkesträff) går INTE att begära,
 * köpa eller konfigurera — de är helt algoritmiska. Det här tar bort spärren; det
 * garanterar dem inte.
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
  permanentRedirect({ href: "/produkter", locale: params.locale });
}
