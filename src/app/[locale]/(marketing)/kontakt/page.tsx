import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { IconMail, IconShield } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "Kontakt",
  description: "Kontakta Foilio — frågor, feedback, buggrapporter eller samarbetsförfrågningar.",
};

export default function ContactPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-ink">Kontakta oss</h1>
      <p className="mt-2 text-ink-muted">
        Vi vill gärna höra från dig — oavsett om det gäller feedback, frågor eller
        buggrapporter.
      </p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        <div className="card-surface flex flex-col items-start gap-3 p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-holo-cyan/10 text-holo-cyan">
            <IconMail size={20} />
          </div>
          <h2 className="font-display text-lg font-semibold text-ink">E-post</h2>
          <p className="text-sm text-ink-muted">
            Allmänna frågor, feedback och samarbeten.
          </p>
          <a
            href="mailto:hej@foilio.se"
            className="mt-auto text-sm font-medium text-holo-cyan hover:underline"
          >
            hej@foilio.se
          </a>
        </div>

        <div className="card-surface flex flex-col items-start gap-3 p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-holo-cyan/10 text-holo-cyan">
            <IconShield size={20} />
          </div>
          <h2 className="font-display text-lg font-semibold text-ink">Säkerhet & GDPR</h2>
          <p className="text-sm text-ink-muted">
            Rapportera säkerhetsproblem eller begär dataexport/radering.
          </p>
          <a
            href="mailto:hej@foilio.se"
            className="mt-auto text-sm font-medium text-holo-cyan hover:underline"
          >
            hej@foilio.se
          </a>
        </div>
      </div>

      <div className="mt-10 space-y-4 text-sm text-ink-muted">
        <h2 className="font-display text-lg font-semibold text-ink">Vanliga ärenden</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Fel pris eller lagerstatus?</strong> — Vi hämtar data automatiskt
            från butikernas webbplatser. Om något stämmer dåligt, meddela oss så
            undersöker vi det.
          </li>
          <li>
            <strong>Vill du lägga till en butik?</strong> — Vi utökar ständigt
            antalet butiker vi bevakar. Skicka ett tips så tittar vi på det.
          </li>
          <li>
            <strong>GDPR-förfrågan?</strong> — Du kan exportera eller radera dina
            uppgifter direkt i{" "}
            <Link href="/installningar" className="text-holo-cyan hover:underline">
              inställningarna
            </Link>. Behöver du mer hjälp, maila oss.
          </li>
        </ul>
      </div>

      <div className="mt-10 rounded-lg border border-surface-border bg-surface-overlay/50 p-5 text-sm text-ink-muted">
        <p>
          <strong className="text-ink">Svarstid:</strong> Vi försöker svara inom
          48 timmar på vardagar. Under högsäsong (release-veckor) kan det ta
          lite längre.
        </p>
      </div>
    </article>
  );
}
