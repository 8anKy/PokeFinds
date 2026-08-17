import { routing } from "@/i18n/routing";
import { localeUrl } from "@/lib/canonical";
import { APP_STORE_URL, DISCORD_URL, INSTAGRAM_URL, TIKTOK_URL } from "@/lib/social-links";

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
        // ⛔ VAD `sameAs` FAKTISKT GÖR — och inte gör. Det är en IDENTITETSSIGNAL:
        // "profilerna nedan är samma enhet som den här domänen". Den används för
        // entitetsförståelse (kunskapspanel, varumärkeskluster), och det är hela
        // vinsten. Den får INTE discord.gg att ranka på något — utgående länkar har
        // aldrig kunnat lyfta målet, och en `sameAs` är inte ens en klickbar länk.
        // Lova aldrig annat i en rapport.
        // ⛔ VARFÖR DET ÄNDÅ ÄR VÄRT DET: "Foilio" är ett namn vi delar med minst två
        // orelaterade verksamheter, och utan sameAs finns ingen maskinläsbar tråd
        // mellan domänen, App Store-appen och våra konton — Google får klustra på
        // gissning. Det här är dessutom den ENDA strukturerade signalen om att Foilio
        // har en Discord; den syns annars bara som en vanlig länk i sidfoten.
        // ⛔ BARA PROFILER VI ÄGER. `sameAs` är ett påstående om identitet: en butiks-,
        // återförsäljar- eller omnämnandelänk här beskriver oss som någon annan.
        // Adresserna bor i @/lib/social-links (en definition, ändras DÄR).
        sameAs: [APP_STORE_URL, DISCORD_URL, INSTAGRAM_URL, TIKTOK_URL],
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
