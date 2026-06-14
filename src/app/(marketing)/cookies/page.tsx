import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Cookiepolicy",
  description: "Information om hur PokeFinds använder cookies och liknande tekniker.",
};

const UPDATED = "1 juni 2026";

export default function CookiesPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-ink">Cookiepolicy</h1>
      <p className="mt-2 text-sm text-ink-faint">Senast uppdaterad: {UPDATED}</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink-muted [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink">
        <section>
          <h2>1. Vad är cookies?</h2>
          <p className="mt-2">
            Cookies är små textfiler som lagras i din webbläsare när du besöker en
            webbplats. De används för att webbplatsen ska fungera korrekt, komma ihåg
            dina inställningar och ge oss anonym statistik om hur tjänsten används.
          </p>
        </section>

        <section>
          <h2>2. Vilka cookies använder vi?</h2>
          <div className="mt-2 space-y-4">
            <div>
              <h3 className="font-semibold text-ink">Nödvändiga cookies</h3>
              <p className="mt-1">
                Dessa krävs för att tjänsten ska fungera — t.ex. inloggningssessioner
                och CSRF-skydd. De kan inte stängas av.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li><strong>next-auth.session-token</strong> — håller dig inloggad</li>
                <li><strong>next-auth.csrf-token</strong> — skyddar mot CSRF-attacker</li>
                <li><strong>next-auth.callback-url</strong> — kommer ihåg vart du ska efter inloggning</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-ink">Preferenscookies</h3>
              <p className="mt-1">
                Sparar dina val, som tema och cookie-samtycke.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li><strong>pokefinds-cookie-consent</strong> — ditt val i cookie-bannern</li>
              </ul>
            </div>
          </div>
        </section>

        <section>
          <h2>3. Tredjepartscookies</h2>
          <p className="mt-2">
            PokeFinds använder inga tredjepartscookies för spårning eller reklam.
            Vi säljer aldrig data till tredje part.
          </p>
        </section>

        <section>
          <h2>4. Så hanterar du cookies</h2>
          <p className="mt-2">
            Du kan radera eller blockera cookies via din webbläsares inställningar.
            Observera att tjänsten kan sluta fungera korrekt om du blockerar
            nödvändiga cookies (t.ex. går det inte att vara inloggad).
          </p>
        </section>

        <section>
          <h2>5. Laglig grund</h2>
          <p className="mt-2">
            Nödvändiga cookies sätts med stöd av berättigat intresse (tjänsten kräver
            dem). Preferenscookies sätts efter ditt samtycke via cookie-bannern.
            Läs mer i vår{" "}
            <Link href="/integritetspolicy" className="text-holo-cyan hover:underline">
              integritetspolicy
            </Link>.
          </p>
        </section>

        <section>
          <h2>6. Kontakt</h2>
          <p className="mt-2">
            Har du frågor om vår cookiehantering? Kontakta oss på{" "}
            <a href="mailto:hej@pokefinds.se" className="text-holo-cyan hover:underline">
              hej@pokefinds.se
            </a>.
          </p>
        </section>
      </div>
    </article>
  );
}
