"use client";

import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { IconChevronRight, IconLock } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * Inställningarnas byggstenar — samma form som nya /mer (more-ui.tsx): versal
 * sektionsetikett + ett kort med hårlinjer, rader på 44 px, ikoner i EN ton.
 *
 * ⛔ ETT REGLAGE, ALDRIG EN KRYSSRUTA. Kryssrutan var det som fick sidan att läsa
 * som ett formulär man fyller i och skickar (ägaren 2026-09-09: "barnslig,
 * otydlig"). En inställning träder i kraft när man rör den — kontrollen för det
 * är ett reglage, och det är också vad varje användare känner igen från sitt
 * operativsystem. Kryssrutan finns kvar för RIKTIGA formulär (raderingsdialogen).
 *
 * ⛔ INGEN BESKRIVNINGSTEXT PER SEKTION. Sju rubriker med var sin grå paragraf var
 * halva sidans höjd och sa inget en etikett inte redan säger. Hinten står kvar
 * BARA där valet faktiskt är svårt — typiskt när det handlar om vad andra ser.
 */

export function SettingsSection({
  title,
  children,
  footer,
}: {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section>
      {title && (
        <h2 className="px-1.5 pb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint">
          {title}
        </h2>
      )}
      <div className="overflow-hidden rounded-[14px] border border-surface-border">{children}</div>
      {footer && <p className="mt-2.5 px-1.5 text-[12.5px] leading-[17px] text-ink-faint">{footer}</p>}
    </section>
  );
}

const ROW = "flex items-center gap-3.5 border-b border-surface-border px-4 py-3 last:border-b-0";

/** Rad utan egen interaktion — etikett vänster, valfritt värde/kontroll höger. */
export function SettingsRow({
  label,
  hint,
  value,
  control,
  indent,
  danger,
}: {
  label: string;
  hint?: string;
  value?: string;
  control?: ReactNode;
  /** Beroende inställning (t.ex. veckobrev under e-post) — indraget BÄR beroendet. */
  indent?: boolean;
  danger?: boolean;
}) {
  return (
    <div className={cn(ROW, indent && "bg-surface-overlay/35 pl-8")}>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-[15px] tracking-[-0.005em]",
            indent ? "font-normal" : "font-medium",
            danger ? "text-fall" : "text-ink"
          )}
        >
          {label}
        </span>
        {hint && <span className="mt-0.5 block text-[12.5px] leading-[17px] text-ink-faint">{hint}</span>}
      </span>
      {value && <span className="shrink-0 text-sm text-ink-faint">{value}</span>}
      {control}
    </div>
  );
}

/** Rad som leder någonstans — inuti appen (Link) eller ut (vanlig <a>). */
export function SettingsLinkRow({
  href,
  label,
  hint,
  value,
  external,
  danger,
  onClick,
}: {
  href?: string;
  label: string;
  hint?: string;
  value?: string;
  external?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-[15px] font-medium tracking-[-0.005em]",
            danger ? "text-fall" : "text-ink"
          )}
        >
          {label}
        </span>
        {hint && <span className="mt-0.5 block text-[12.5px] leading-[17px] text-ink-faint">{hint}</span>}
      </span>
      {value && <span className="shrink-0 text-sm text-ink-faint">{value}</span>}
      <IconChevronRight size={18} className="shrink-0 text-ink-faint" />
    </>
  );
  const className = cn(ROW, "w-full text-left transition-colors hover:bg-surface-overlay/60 active:bg-surface-overlay");
  if (href && external) {
    return (
      <a href={href} className={className}>
        {body}
      </a>
    );
  }
  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

/**
 * Reglaget. En `<button role="switch">`, inte en `<input type="checkbox">`:
 * tillståndet läses upp som "på/av" av skärmläsare, och hela ytan är träffbar.
 */
export function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-holo-cyan disabled:opacity-50",
        checked ? "bg-holo-cyan" : "bg-surface-overlay ring-1 ring-inset ring-surface-border"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-[3px] h-5 w-5 rounded-full transition-[left,background-color] duration-200 motion-reduce:transition-none",
          checked ? "left-[21px] bg-[#04211e]" : "left-[3px] bg-ink-faint"
        )}
      />
    </button>
  );
}

/** Låst reglage — "PRO" + hänglås. Trycket säljer, det växlar aldrig. */
export function ProLockControl({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-holo-cyan"
    >
      {label}
      <IconLock size={16} />
    </button>
  );
}
