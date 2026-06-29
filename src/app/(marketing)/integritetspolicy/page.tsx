import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Integritetspolicy",
  description: "Så behandlar Foilio dina personuppgifter — i enlighet med GDPR.",
};

const UPDATED = "29 juni 2026";

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-ink">Integritetspolicy</h1>
      <p className="mt-2 text-sm text-ink-faint">Senast uppdaterad: {UPDATED}</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink-muted [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink">
        <section>
          <h2>1. Personuppgiftsansvarig</h2>
          <p className="mt-2">
            Foilio är personuppgiftsansvarig för behandlingen av dina
            personuppgifter i tjänsten. Kontakta oss på{" "}
            <a href="mailto:hej@foilio.se" className="text-holo-cyan hover:underline">
              hej@foilio.se
            </a>{" "}
            vid frågor om denna policy.
          </p>
        </section>

        <section>
          <h2>2. Vilka uppgifter vi behandlar</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><strong className="text-ink">Kontouppgifter:</strong> e-postadress, namn och krypterat lösenord.</li>
            <li><strong className="text-ink">Samlingsdata:</strong> kort och produkter du registrerat, inköpspriser, skick och anteckningar.</li>
            <li><strong className="text-ink">Bevakningar och notiser:</strong> vilka produkter du bevakar och dina notisinställningar.</li>
            <li><strong className="text-ink">Community-innehåll:</strong> inlägg, kommentarer och reaktioner du publicerar.</li>
            <li><strong className="text-ink">Kortbilder vid skanning:</strong> när du skannar eller laddar upp ett kort skickas bilden till vår AI-leverantör för identifiering. Bilden behandlas tillfälligt och sparas inte i din kamerarulle eller långsiktigt hos oss.</li>
            <li><strong className="text-ink">Teknisk data:</strong> nödvändiga sessionsuppgifter för inloggning.</li>
          </ul>
        </section>

        <section>
          <h2>3. Ändamål och rättslig grund</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong className="text-ink">Tillhandahålla tjänsten</strong> (konto, bevakningar,
              samling, notiser) — rättslig grund: fullgörande av avtal (art. 6.1 b GDPR).
            </li>
            <li>
              <strong className="text-ink">Skicka alerts och veckorapporter</strong> du själv valt —
              fullgörande av avtal; du kan stänga av dem i Inställningar.
            </li>
            <li>
              <strong className="text-ink">Drift, säkerhet och felsökning</strong> — berättigat
              intresse (art. 6.1 f GDPR).
            </li>
            <li>
              <strong className="text-ink">Rättsliga skyldigheter</strong>, t.ex. bokföring vid
              betalningar — rättslig förpliktelse (art. 6.1 c GDPR).
            </li>
          </ul>
          <p className="mt-2">
            Vi säljer aldrig dina uppgifter och använder dem inte för tredjeparts
            marknadsföring.
          </p>
        </section>

        <section>
          <h2>4. Lagringstid</h2>
          <p className="mt-2">
            Vi sparar dina uppgifter så länge du har ett konto. Raderar du kontot tas
            dina personuppgifter bort inom 30 dagar, med undantag för uppgifter vi är
            skyldiga att spara enligt lag (t.ex. bokföringsunderlag, som sparas i 7
            år). Säkerhetskopior rensas löpande.
          </p>
        </section>

        <section>
          <h2>5. Dina rättigheter</h2>
          <p className="mt-2">Enligt GDPR har du rätt att:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><strong className="text-ink">Få tillgång</strong> till de uppgifter vi har om dig,</li>
            <li><strong className="text-ink">rätta</strong> felaktiga uppgifter,</li>
            <li><strong className="text-ink">radera</strong> ditt konto och dina uppgifter,</li>
            <li><strong className="text-ink">exportera</strong> din data i maskinläsbart format (dataportabilitet),</li>
            <li>invända mot eller begära begränsning av viss behandling,</li>
            <li>lämna klagomål till Integritetsskyddsmyndigheten (IMY).</li>
          </ul>
          <p className="mt-2">
            Export och radering finns direkt i <strong className="text-ink">Inställningar</strong> i
            tjänsten — du behöver inte kontakta oss för att använda dina rättigheter,
            men du är alltid välkommen att göra det.
          </p>
        </section>

        <section>
          <h2>6. Cookies</h2>
          <p className="mt-2">
            Vi använder endast nödvändiga cookies, för inloggning (sessionscookie) och
            grundläggande funktion. Vi använder inga spårnings- eller
            marknadsföringscookies från tredje part. Eftersom alla cookies är
            nödvändiga krävs inget samtycke, men vi informerar om dem via vår
            cookie-banner.
          </p>
        </section>

        <section>
          <h2>7. Delning och underleverantörer</h2>
          <p className="mt-2">
            Vi anlitar följande personuppgiftsbiträden för att driva tjänsten, alla
            bundna av personuppgiftsbiträdesavtal:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><strong className="text-ink">Databas:</strong> Neon (serverlös PostgreSQL, datalagring inom EU/EES, Frankfurt).</li>
            <li><strong className="text-ink">Drift/hosting:</strong> vår molnvärd som kör applikationen.</li>
            <li><strong className="text-ink">E-postutskick:</strong> Resend, för alerts och kontomejl (USA).</li>
            <li><strong className="text-ink">AI-identifiering av kort:</strong> Anthropic (Claude), som bearbetar skannade kortbilder (USA). Bilderna sparas inte hos leverantören efter bearbetning.</li>
          </ul>
          <p className="mt-2">
            Lagring av din kontodata sker inom EU/EES. Vid överföring till tredjeland
            (t.ex. USA för e-post och AI-identifiering) används godkända
            skyddsmekanismer enligt GDPR, såsom EU:s standardavtalsklausuler. Vi säljer
            aldrig dina uppgifter.
          </p>
        </section>

        <section>
          <h2>8. Ändringar</h2>
          <p className="mt-2">
            Vid väsentliga ändringar av denna policy informerar vi dig via e-post
            eller i tjänsten. Den senaste versionen finns alltid på denna sida. Se
            även våra{" "}
            <Link href="/villkor" className="text-holo-cyan hover:underline">
              användarvillkor
            </Link>
            .
          </p>
        </section>
      </div>
    </article>
  );
}
