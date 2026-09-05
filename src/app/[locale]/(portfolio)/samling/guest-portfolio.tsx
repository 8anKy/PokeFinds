import { getTranslations } from "next-intl/server";
import { LinkButton } from "@/components/ui/button";
import {
  IconCamera,
  IconCards,
  IconChart,
  IconGem,
  IconReceipt,
  type IconProps,
} from "@/components/ui/icons";

/**
 * "Portfölj" för en GÄST (2026-09-05). Förut: omdirigering till inloggningen.
 * Nu: vad portföljen gör och två knappar. ⛔ Inga exempeltal — en påhittad
 * "10 267 kr" är precis den sortens fabricerade data vi aldrig visar.
 */
export async function GuestPortfolio() {
  const t = await getTranslations("Collection");
  const features: { icon: (p: IconProps) => JSX.Element; title: string; body: string; tone: string }[] = [
    { icon: IconGem, title: t("guestValueTitle"), body: t("guestValueBody"), tone: "text-holo-cyan" },
    { icon: IconChart, title: t("guestChartTitle"), body: t("guestChartBody"), tone: "text-rise" },
    { icon: IconCards, title: t("guestSetsTitle"), body: t("guestSetsBody"), tone: "text-holo-violet" },
    { icon: IconCamera, title: t("guestScanTitle"), body: t("guestScanBody"), tone: "text-holo-gold" },
    { icon: IconReceipt, title: t("guestSoldTitle"), body: t("guestSoldBody"), tone: "text-ink-muted" },
  ];

  return (
    <div className="mx-auto max-w-md space-y-4">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink">{t("h1")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("guestSubtitle")}</p>
      </header>

      <div className="rounded-2xl border border-holo-cyan/30 bg-holo-cyan/10 px-4 py-4">
        <p className="text-sm font-semibold text-ink">{t("guestCtaTitle")}</p>
        <p className="mt-1 text-xs text-ink-muted">{t("guestCtaBody")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <LinkButton href="/registrera" size="sm">
            {t("guestRegister")}
          </LinkButton>
          <LinkButton href="/logga-in?callbackUrl=%2Fsamling" size="sm" variant="outline">
            {t("guestLogin")}
          </LinkButton>
        </div>
      </div>

      <ul className="overflow-hidden rounded-2xl border border-surface-border bg-surface-raised/40">
        {features.map((f) => (
          <li
            key={f.title}
            className="flex items-start gap-3 border-b border-surface-border px-4 py-3 last:border-b-0"
          >
            <span
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-overlay ${f.tone}`}
            >
              <f.icon size={18} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">{f.title}</span>
              <span className="block text-xs leading-relaxed text-ink-muted">{f.body}</span>
            </span>
          </li>
        ))}
      </ul>

      <p className="text-center text-xs text-ink-faint">{t("guestFootnote")}</p>
    </div>
  );
}
