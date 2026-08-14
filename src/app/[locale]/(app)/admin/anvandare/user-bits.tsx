/**
 * Delade visningsbitar för adminens användarvyer (lista + detalj).
 *
 * Ligger separat för att listan och detaljsidan MÅSTE säga samma sak om samma
 * fält — en användare som ser "Push: på" i listan och "Push: av" i detaljen
 * kan inte felsöka någonting.
 */
import { Badge } from "@/components/ui/badge";
import type { NotificationSettings } from "@/lib/notification-settings";

/**
 * AI-kostnad i öre → läsbar sträng.
 *
 * ⛔ `formatPrice()` duger inte här: ett enskilt Haiku-anrop kostar ~2,5 öre och
 * hade blivit "0,03 kr", vilket ser ut som avrundningsbrus i stället för ett
 * mätvärde. Under en krona visas därför öre.
 *
 * ⛔ **NOLL ÄR ETT GILTIGT SVAR HÄR** — till skillnad från ett marknadspris
 * (där "0 kr" läses som "gratis" och är en lögn) betyder 0 kr i den här vyn att
 * användaren bevisligen inte kostat något. Det som INTE får visas som noll är
 * en OMÄTT rad; den räknas separat, se `unmeasured` i user-costs.ts.
 */
export function formatCostOre(ore: number): string {
  if (ore === 0) return "0 kr";
  if (ore < 100) return `${ore} öre`;
  const kr = ore / 100;
  return `${kr.toLocaleString("sv-SE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} kr`;
}

const PLATFORM_LABELS: Record<string, string> = {
  ios: "iOS",
  android: "Android",
  web: "Webb",
};

/**
 * Enheter → "iOS ×2, Android". En registrerad push-token är det enda BEVISET
 * vi har på att den nativa appen är installerad: den skapas av
 * `/api/push/subscribe`, som bara kan nås inifrån appen.
 *
 * ⛔ Frånvaro bevisar INTE motsatsen. En användare kan ha appen installerad och
 * ha nekat push-behörighet — då finns ingen token. Texten säger därför
 * "Ingen enhet", aldrig "Ingen app".
 */
export function describeDevices(platforms: string[]): string {
  if (platforms.length === 0) return "Ingen enhet";
  const counts = new Map<string, number>();
  for (const p of platforms) {
    const label = PLATFORM_LABELS[p] ?? p;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, n]) => (n > 1 ? `${label} ×${n}` : label))
    .join(", ");
}

/** Kompakta notis-brickor: E, P, ALLA. Nedtonade när de är avstängda. */
export function NotificationBadges({
  settings,
}: {
  settings: NotificationSettings;
}) {
  const items: { key: string; label: string; on: boolean; title: string }[] = [
    { key: "email", label: "E", on: settings.email, title: "E-postnotiser" },
    { key: "push", label: "P", on: settings.push, title: "Push-notiser" },
    {
      key: "all",
      label: "ALLA",
      on: settings.allRestocks,
      title: "Alla restocks (Pro-opt-in)",
    },
  ];
  return (
    <span className="flex flex-wrap items-center gap-1">
      {items.map((i) => (
        <span
          key={i.key}
          title={`${i.title}: ${i.on ? "på" : "av"}`}
          className={
            i.on
              ? "rounded border border-holo-cyan/40 bg-holo-cyan/10 px-1.5 py-0.5 text-[11px] font-medium text-holo-cyan"
              : "rounded border border-surface-border px-1.5 py-0.5 text-[11px] text-ink-faint"
          }
        >
          {i.label}
        </span>
      ))}
    </span>
  );
}

/** "Senast sedd" — aldrig "online nu", se User.lastSeenAt i schema.prisma. */
export function LastSeen({ iso }: { iso: string | null }) {
  if (!iso) {
    return (
      <span className="text-ink-faint" title="Ingen inloggad aktivitet registrerad">
        Aldrig
      </span>
    );
  }
  const d = new Date(iso);
  const minutes = Math.floor((Date.now() - d.getTime()) / 60_000);
  const label =
    minutes < 60
      ? `${Math.max(0, minutes)} min sedan`
      : minutes < 60 * 24
        ? `${Math.floor(minutes / 60)} tim sedan`
        : minutes < 60 * 24 * 30
          ? `${Math.floor(minutes / (60 * 24))} d sedan`
          : new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium" }).format(d);
  return (
    <span
      className={minutes < 60 * 24 * 7 ? undefined : "text-ink-faint"}
      title={new Intl.DateTimeFormat("sv-SE", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(d)}
      // ⛔ Etiketten är RELATIV till `Date.now()`. I användarlistan renderas den
      // först på servern och hydreras sedan i webbläsaren; korsas en
      // minutgräns däremellan är strängarna olika och React loggar en
      // hydreringsmiss. Klockslaget i `title` är absolut och opåverkat.
      suppressHydrationWarning
    >
      {label}
    </span>
  );
}

/** Grön bock / grå kryss för ett booleskt tillstånd. */
export function YesNo({ value, title }: { value: boolean; title?: string }) {
  return (
    <span
      title={title}
      className={value ? "text-holo-cyan" : "text-ink-faint"}
      aria-label={value ? "Ja" : "Nej"}
    >
      {value ? "✓" : "–"}
    </span>
  );
}

/** Plan + var den kommer ifrån. Pro kan komma från fyra oberoende källor. */
export function PlanBadge({ isPro, planTier }: { isPro: boolean; planTier: string }) {
  if (!isPro) return <Badge variant="default">Gratis</Badge>;
  return (
    <Badge variant="holo" title={planTier === "PREMIUM" ? "planTier=PREMIUM" : "Pro via bonus/Stripe/roll"}>
      Pro
    </Badge>
  );
}
