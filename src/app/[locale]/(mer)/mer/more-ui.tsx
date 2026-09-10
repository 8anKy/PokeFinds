import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { SOCIAL_CHANNELS } from "@/components/features/join-us-card";
import { IconChevronRight, type IconProps } from "@/components/ui/icons";

/**
 * Byggstenarna som /mer:s två versioner (inloggad och gäst) DELAR.
 *
 * ⛔ Gästen och den inloggade ska läsa som samma sida, inte som två sidor med
 * samma namn: samma foliekort överst, samma sektionsetiketter, samma radhöjd,
 * samma kanalbrickor. Skillnaden är VAD som står i dem — inte hur de ser ut.
 * Ligger en variant och driver för sig blir /mer det första en besökare ser av
 * appen, och det första hen ser är då något annat än det hen får.
 */

export interface MenuLink {
  href: string;
  label: string;
  /** Utelämnad för dokumentrader (villkor, cookies): de är text, inte platser. */
  icon?: (p: IconProps) => JSX.Element;
  /** Höger om etiketten: ett tal, aldrig en färgad etikett. */
  value?: string;
  /** Turkos prick i stället för ett tal (olästa meddelanden). */
  dot?: boolean;
}

/**
 * Sidans rytm: en sektion = en versal etikett + ett kort med hårlinjer emellan.
 *
 * ⛔ IKONERNA ÄR ENFÄRGADE (ink-faint) MED FLIT. Den gamla sidan gav varje rad
 * sin egen färg — cyan, grön, violett, guld, grått, violett, rött — utan att
 * färgen betydde något; sju färger som inte kodar något läser som dekor, och
 * det var det ägaren kallade barnsligt (2026-09-09). Turkos är kvar som EN
 * signal på sidan: Pro. Lägg inte tillbaka en färg per rad.
 */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="px-1.5 pb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint">
        {title}
      </h2>
      <div className="overflow-hidden rounded-[14px] border border-surface-border">{children}</div>
    </section>
  );
}

export function MenuRow({ link }: { link: MenuLink }) {
  return (
    <Link
      href={link.href}
      className="flex items-center gap-3.5 border-b border-surface-border px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-overlay/60 active:bg-surface-overlay"
    >
      {link.icon && <link.icon size={20} className="shrink-0 text-ink-faint" />}
      <span className="flex-1 text-[15px] font-medium tracking-[-0.005em] text-ink">{link.label}</span>
      {link.value && <span className="text-sm tabular-nums text-ink-faint">{link.value}</span>}
      {link.dot && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-holo-cyan" />}
      <IconChevronRight size={18} className="shrink-0 text-ink-faint" />
    </Link>
  );
}

/**
 * Foliekortet. Glansen ligger i fyra `aria-hidden`-lager UNDER innehållet
 * (`.foil-panel__face`) — se kommentaren vid `.foil-panel` i globals.css för
 * varför det här kortet rör sig mindre än Pro-kortet.
 *
 * ⛔ `foil` VÄLJER METALL, den slår inte på och av glansen (2026-09-10). Pro får
 * turkos folie, gratiskontot och gästen får grå — SAMMA fyra lager, samma
 * rörelse, samma form. Förmånen är alltså kvar (turkos är Pro-signalen på hela
 * sidan) men den som inte betalar får ändå ett kort som lever. Ge aldrig
 * gratisvarianten turkos "för att det ser bättre ut" — då är det ingen förmån
 * längre, och Pro har en säljpunkt mindre.
 */
export function FoilPanel({
  href,
  foil,
  children,
}: {
  href?: string;
  foil: boolean;
  children: ReactNode;
}) {
  const inner = (
    <>
      <span aria-hidden className="foil-panel__foil" />
      <span aria-hidden className="foil-panel__lines" />
      <span aria-hidden className="foil-panel__spark" />
      <span aria-hidden className="foil-panel__glare" />
      <span className="foil-panel__face block">{children}</span>
    </>
  );
  const className = `foil-panel${foil ? "" : " foil-panel--grey"} block rounded-[18px] border border-surface-border p-[18px] transition-colors`;
  // Gästens kort bär egna knappar och får därför inte vara en länk själv —
  // en länk runt två knappar gör hela kortet till en tredje, otydlig, träffyta.
  return href ? (
    <Link href={href} className={`${className} hover:border-ink/20`}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

/** En rad av tre kanalbrickor — inte tre menyrader. Externa länkar öppnar
 *  utanför appen, så de får inte se ut som appens egen navigering. */
export function FollowTiles({ title }: { title: string }) {
  return (
    <section>
      <h2 className="px-1.5 pb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint">
        {title}
      </h2>
      <div className="grid grid-cols-3 gap-2">
        {SOCIAL_CHANNELS.map((c) => (
          <a
            key={c.label}
            href={c.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-[66px] flex-col items-center justify-center gap-1.5 rounded-[14px] border border-surface-border text-ink-muted transition-colors hover:bg-surface-overlay/60 hover:text-ink active:bg-surface-overlay"
          >
            <c.icon size={20} className="shrink-0" />
            <span className="text-xs font-medium">{c.label}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
