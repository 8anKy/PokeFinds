import type { Metadata } from "next";
import { LinkButton } from "@/components/ui/button";
import { IconCheck, IconPlus } from "@/components/ui/icons";
import { UpgradeButton } from "./upgrade-button";

export const metadata: Metadata = {
  title: "Priser",
  description:
    "Kom igång gratis med Foilio eller uppgradera till Pro för obegränsade bevakningar, alla restock-larm och AI-gradering.",
};

const FREE_FEATURES = [
  "10 bevakningar med pris- och restock-alerts",
  "5 AI-graderingar och 10 skanningar per dag",
  "Grundläggande samling med värdeöversikt",
  "Grundläggande marknadsdata och prisgrafer",
  "Community-åtkomst",
];

const PREMIUM_FEATURES = [
  "Obegränsade alerts och bevakningar",
  "Alla restocks — larm för varje sealed-produkt",
  "AI-gradering med starkare modell (30/dygn)",
  "Kortskanning (100/dygn)",
  "Avancerade prisgrafer och längre historik",
  "CSV-import och -export samt veckorapporter",
];

const FAQ = [
  {
    q: "Kan jag byta plan när som helst?",
    a: "Ja. Du kan uppgradera eller säga upp Pro när du vill, utan bindningstid. Köpet hanteras av App Store / Google Play.",
  },
  {
    q: "Vad händer med mina bevakningar om jag nedgraderar?",
    a: "Dina bevakningar finns kvar, men bara de 10 senaste är aktiva på gratisnivån. Du väljer själv vilka som ska vara aktiva.",
  },
  {
    q: "Hur betalar jag för Pro?",
    a: "I appen sker köpet säkert via App Store eller Google Play. På webben lanseras betalning inom kort — tills dess är gratisnivån öppen för alla.",
  },
];

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3">
      {items.map((f) => (
        <li key={f} className="flex items-start gap-2.5 text-sm text-ink-muted">
          <IconCheck size={18} className="mt-0.5 shrink-0 text-rise" />
          {f}
        </li>
      ))}
    </ul>
  );
}

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <div className="text-center">
        <h1 className="font-display text-3xl font-bold text-ink sm:text-4xl">
          Enkel prissättning, inga överraskningar
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-ink-muted">
          Kom igång gratis. Uppgradera när du vill ha full koll på marknaden —
          säg upp när som helst.
        </p>
      </div>

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        {/* Free */}
        <div className="card-surface flex flex-col p-8">
          <h2 className="font-display text-xl font-semibold text-ink">Free</h2>
          <p className="mt-1 text-sm text-ink-muted">För dig som vill testa vattnet.</p>
          <p className="mt-6" data-price>
            <span className="font-display text-4xl font-bold text-ink">0 kr</span>
            <span className="text-ink-muted"> / månad</span>
          </p>
          <div className="mt-8 flex-1">
            <FeatureList items={FREE_FEATURES} />
          </div>
          <LinkButton href="/registrera" variant="secondary" className="mt-8 w-full">
            Skapa gratiskonto
          </LinkButton>
        </div>

        {/* Premium — rekommenderad: foil-linje + tydligare kant */}
        <div className="card-surface flex flex-col overflow-hidden border-holo-cyan/40">
          <div className="foil-line" aria-hidden="true" />
          <div className="flex flex-1 flex-col p-8">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-xl font-semibold text-ink">Pro</h2>
              <span className="text-xs font-medium text-holo-cyan">
                För seriösa samlare
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              Full koll på marknaden — innan alla andra.
            </p>
            <p className="mt-6" data-price>
              <span className="holo-text font-display text-4xl font-bold">49 kr</span>
              <span className="text-ink-muted"> / månad</span>
            </p>
            <div className="mt-8 flex-1">
              <FeatureList items={PREMIUM_FEATURES} />
            </div>
            <UpgradeButton />
          </div>
        </div>
      </div>

      {/* FAQ */}
      <section className="mt-20">
        <h2 className="text-center font-display text-2xl font-bold text-ink">
          Frågor om planerna
        </h2>
        <div className="mt-6 space-y-3">
          {FAQ.map((item) => (
            <details key={item.q} className="card-surface group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-medium text-ink [&::-webkit-details-marker]:hidden">
                {item.q}
                <IconPlus
                  size={18}
                  className="shrink-0 text-ink-faint transition-transform group-open:rotate-45"
                />
              </summary>
              <p className="border-t border-surface-border px-5 py-4 text-sm text-ink-muted">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
