import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";

export const metadata: Metadata = {
  title: "Om Foilio",
  description: "Foilio är Sveriges marknadsplattform för Pokémon TCG — prisbevakning, restock-alerts och samlingsverktyg.",
};

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-ink">Om Foilio</h1>
      <p className="mt-2 text-sm text-ink-faint">Sveriges Pokémon TCG-plattform</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink-muted [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink">
        <section>
          <h2>Vad är Foilio?</h2>
          <p className="mt-2">
            Foilio är en svensk webbplattform byggd för Pokémon TCG-samlare.
            Vi samlar priser och lagerstatus från svenska butiker så att du slipper
            kolla varje sajt manuellt. Här kan du jämföra priser, bevaka produkter,
            få restock-alerts och hålla koll på värdet av din samling — allt på ett ställe.
          </p>
        </section>

        <section>
          <h2>Vad vi gör</h2>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>
              <strong>Prisjämförelse</strong> — Vi hämtar priser från flera svenska
              butiker och visar det lägsta priset, prishistorik och trender.
            </li>
            <li>
              <strong>Restock-alerts</strong> — Få notifikationer direkt när en
              produkt du bevakar kommer i lager igen.
            </li>
            <li>
              <strong>Samlingshantering</strong> — Logga dina kort och sealed-produkter,
              se totalvärde och följ hur din samling utvecklas.
            </li>
            <li>
              <strong>Marknadsdata</strong> — Trender, prisfall, mest bevakade produkter
              och set-index ger dig koll på marknaden.
            </li>
            <li>
              <strong>Community</strong> — Dela pulls, diskutera trades och häng med
              andra svenska samlare.
            </li>
          </ul>
        </section>

        <section>
          <h2>Oberoende tjänst</h2>
          <p className="mt-2">
            Foilio är en helt oberoende tjänst. Vi är inte anslutna till,
            sponsrade av eller godkända av The Pokémon Company, Nintendo eller
            någon återförsäljare. Pokémon och relaterade namn är varumärken som
            tillhör sina respektive ägare.
          </p>
        </section>

        <section>
          <h2>Kontakta oss</h2>
          <p className="mt-2">
            Har du frågor, feedback eller vill rapportera ett problem? Skriv till{" "}
            <a href="mailto:hej@foilio.se" className="text-holo-cyan hover:underline">
              hej@foilio.se
            </a>{" "}
            eller besök vår{" "}
            <Link href="/kontakt" className="text-holo-cyan hover:underline">
              kontaktsida
            </Link>.
          </p>
        </section>
      </div>
    </article>
  );
}
