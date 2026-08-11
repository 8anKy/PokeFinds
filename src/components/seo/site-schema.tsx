import { routing } from "@/i18n/routing";
import { localeUrl } from "@/lib/canonical";

/**
 * `Organization` + `WebSite` som JSON-LD — schemat Google använder för att förstå
 * att en domän ÄR ett varumärke, och förutsättningen för att en varumärkessökning
 * ska bli EN samlad träff i stället för en platt lista av lösa sidor.
 *
 * ⛔ VARFÖR FILEN FINNS (2026-08-11): sajten hade INGET av det här. En
 * inkognitosökning på "www.foilio.se" gav sex separata blå träffar — överst
 * `/logga-in` — plus en AI-översikt som påstod att adressen "inte leder till en
 * aktiv svensk webbplats". Roten var att `/` var en 307 (nu 308), men Google
 * saknade dessutom varje strukturerad signal om vem vi är.
 *
 * ⛔ MONTERAS PÅ EXAKT EN SIDA. Google vill ha `Organization`/`WebSite` en gång,
 * på sajtens ingång — inte upprepat på varje sida. Vår ingång är `/produkter`
 * (`/` omdirigerar dit sedan startsidan togs bort 2026-08-06), så noden bor där.
 * Flyttas startsidan tillbaka till `/` ska den här komponenten flytta med.
 *
 * ⛔ IDENTITETEN ÄR DOMÄNEN, INTE SPRÅKVERSIONEN. `url`/`@id` byggs på roten även
 * på /en: Foilio är samma organisation oavsett vilket språk sidan renderas på, och
 * två olika `@id` per locale hade beskrivit två olika företag. Kanoniska URL:er är
 * en annan fråga och sköts av `alternatesFor()`.
 *
 * ⛔ INGEN `SearchAction`/sitelinks-searchbox. Den kräver en söksida som svarar på
 * en GET-parameter vi lovar hålla stabil, och `/produkter?q=` är just den
 * URL-rymd robots.txt BLOCKERAR (oändliga facettkombinationer, en Neon-render per
 * träff). Att bjuda in Google att söka på en väg vi samtidigt förbjuder vore att
 * be om en motsägelse i rapporterna.
 *
 * ⛔ Sitelinks går inte att begära, köpa eller konfigurera — de är algoritmiska.
 * Det här tar bort en spärr; det garanterar ingenting.
 */
export function SiteSchema({ locale }: { locale: string }) {
  // localeUrl(defaultLocale, "/") ger `${BASE_URL}/` — sajtens rot utan språkprefix.
  const root = localeUrl(routing.defaultLocale, "/");
  const origin = root.replace(/\/$/, "");

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${origin}/#organization`,
        name: "Foilio",
        url: root,
        logo: `${origin}/brand/foilio-logo.png`,
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        name: "Foilio",
        url: root,
        publisher: { "@id": `${origin}/#organization` },
        inLanguage: locale === "en" ? "en" : "sv-SE",
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // <-escapen: JSON.stringify escapar inte "<" (samma skäl som produktsidan).
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }}
    />
  );
}
