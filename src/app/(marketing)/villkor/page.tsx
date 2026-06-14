import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Användarvillkor",
  description: "Användarvillkor för PokeFinds — tjänsten som hjälper dig bevaka Pokémon TCG-marknaden.",
};

const UPDATED = "1 juni 2026";

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-ink">Användarvillkor</h1>
      <p className="mt-2 text-sm text-ink-faint">Senast uppdaterad: {UPDATED}</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink-muted [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink">
        <section>
          <h2>1. Om tjänsten</h2>
          <p className="mt-2">
            PokeFinds är en svensk webbtjänst som samlar in och presenterar prisdata,
            lagerstatus och marknadstrender för Pokémon TCG-produkter, samt erbjuder
            verktyg för bevakning, samlingshantering och community. Genom att skapa ett
            konto eller använda tjänsten godkänner du dessa villkor.
          </p>
          <p className="mt-2">
            PokeFinds är en oberoende tjänst och är inte ansluten till, sponsrad av
            eller godkänd av The Pokémon Company eller någon återförsäljare. Pokémon
            och relaterade namn är varumärken som tillhör sina respektive ägare.
          </p>
        </section>

        <section>
          <h2>2. Konto</h2>
          <p className="mt-2">
            Du måste vara minst 16 år för att skapa ett konto. Du ansvarar för att de
            uppgifter du anger är korrekta och för att hålla dina inloggningsuppgifter
            hemliga. All aktivitet som sker via ditt konto betraktas som utförd av dig.
            Misstänker du att någon obehörig fått tillgång till ditt konto ska du
            omedelbart byta lösenord och kontakta oss.
          </p>
        </section>

        <section>
          <h2>3. Acceptabel användning</h2>
          <p className="mt-2">Du får inte:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>använda tjänsten för olagliga ändamål eller i strid med dessa villkor,</li>
            <li>försöka kringgå tekniska begränsningar, skrapa eller massinhämta data från tjänsten utan skriftligt tillstånd,</li>
            <li>publicera innehåll i communityt som är kränkande, vilseledande, upphovsrättsintrång eller spam,</li>
            <li>sälja, hyra ut eller dela ditt konto med andra,</li>
            <li>störa tjänstens drift, exempelvis genom överbelastning eller intrångsförsök.</li>
          </ul>
          <p className="mt-2">
            Vi förbehåller oss rätten att ta bort innehåll och stänga av konton som
            bryter mot dessa regler.
          </p>
        </section>

        <section>
          <h2>4. Prisdata utan garanti</h2>
          <p className="mt-2">
            Priser, lagerstatus och annan marknadsdata hämtas automatiskt från externa
            källor och kan vara fördröjda, ofullständiga eller felaktiga. Datan
            tillhandahålls i befintligt skick, utan garantier. Det pris som gäller är
            alltid det som visas hos respektive butik vid köptillfället. PokeFinds
            säljer inga produkter och är inte part i köp som genomförs hos butiker som
            länkas från tjänsten. Värderingar av samlingar är uppskattningar och ska
            inte ses som finansiell rådgivning.
          </p>
        </section>

        <section>
          <h2>5. Ansvarsbegränsning</h2>
          <p className="mt-2">
            Tjänsten tillhandahålls i befintligt skick och i mån av tillgänglighet. I
            den utsträckning lagen tillåter ansvarar PokeFinds inte för indirekta
            skador, utebliven vinst eller förluster som uppstår till följd av att du
            förlitat dig på data i tjänsten, driftstörningar eller förlorad data.
            Inget i dessa villkor begränsar rättigheter du har som konsument enligt
            tvingande svensk lag.
          </p>
        </section>

        <section>
          <h2>6. Premium och betalning</h2>
          <p className="mt-2">
            Vissa funktioner kräver ett Premium-abonnemang. Aktuella priser och
            funktioner framgår av prissidan. Abonnemanget löper månadsvis utan
            bindningstid och kan sägas upp när som helst i Inställningar; det gäller
            då till slutet av den betalda perioden.
          </p>
        </section>

        <section>
          <h2>7. Uppsägning</h2>
          <p className="mt-2">
            Du kan avsluta ditt konto när som helst via Inställningar, varvid dina
            personuppgifter raderas i enlighet med vår integritetspolicy. Vi kan
            stänga av eller avsluta konton som bryter mot dessa villkor eller om
            tjänsten läggs ner, med rimlig förvarning där det är möjligt.
          </p>
        </section>

        <section>
          <h2>8. Ändringar av villkoren</h2>
          <p className="mt-2">
            Vi kan uppdatera dessa villkor, exempelvis vid nya funktioner eller ändrad
            lagstiftning. Väsentliga ändringar meddelas via e-post eller i tjänsten
            minst 30 dagar i förväg. Fortsatt användning efter att ändringarna trätt i
            kraft innebär att du godkänner de nya villkoren.
          </p>
        </section>

        <section>
          <h2>9. Tillämplig lag och kontakt</h2>
          <p className="mt-2">
            Svensk lag gäller för dessa villkor. Tvister prövas av svensk allmän
            domstol. Frågor om villkoren? Kontakta oss på{" "}
            <a href="mailto:hej@pokefinds.se" className="text-holo-cyan hover:underline">
              hej@pokefinds.se
            </a>
            .
          </p>
        </section>
      </div>
    </article>
  );
}
