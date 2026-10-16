"use client";

/**
 * /sets som rutor (ägarbeslut 2026-10-16): logga, släppdatum, stapel "ägda / kort",
 * setvärde och — inloggad — värdet av det man äger ur setet.
 *
 * ⛔ GRÅ = INLOGGAD OCH ÄGER INGET UR SETET. En utloggad besökare ser rutorna i färg:
 * sidan är också katalogens ingång från sök, och en helt grå vägg säljer ingenting.
 *
 * Det personliga hämtas EN gång per sidvisning (`/api/sets/owned`) och bara när
 * fo_auth-hinten säger inloggad — sidan är ISR och får aldrig kalla `auth()`.
 * ⛔ Bar `fetch`, inte `apiFetch`: en inaktuell hint får inte skicka besökaren till
 * inloggningen från en publik sida (apiFetch omdirigerar vid 401).
 */
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { setPath } from "@/lib/set-slug";
import { formatPrice } from "@/lib/format";
import { useAuthHint } from "@/lib/auth-hint";
import { cn } from "@/lib/utils";
import type { SetTile } from "@/services/sets-gallery";

type Owned = Record<string, { owned: number; valueOre: number }>;

const TAB_KEY = "scoutr:sets-tab";

function shortDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "sv-SE", { year: "numeric", month: "short", day: "numeric" }).format(
    new Date(iso)
  );
}

export function SetsGallery({ sets }: { sets: SetTile[] }) {
  const t = useTranslations("Sets");
  const locale = useLocale();
  const loggedIn = useAuthHint();
  const [owned, setOwned] = useState<Owned | null>(null);
  const [tab, setTab] = useState<"EN" | "JP">("EN");
  const [broken, setBroken] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      if (window.localStorage.getItem(TAB_KEY) === "JP") setTab("JP");
    } catch {
      /* privat läge */
    }
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    let alive = true;
    fetch("/api/sets/owned", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setOwned(d as Owned))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [loggedIn]);

  const hasJp = useMemo(() => sets.some((s) => s.language === "JP"), [sets]);
  const shown = useMemo(() => sets.filter((s) => s.language === tab), [sets, tab]);
  const now = Date.now();

  function pick(next: "EN" | "JP") {
    setTab(next);
    try {
      window.localStorage.setItem(TAB_KEY, next);
    } catch {
      /* privat läge */
    }
  }

  return (
    <div className="mt-6">
      {hasJp && (
        <div role="tablist" className="inline-flex rounded-xl border border-surface-border p-1">
          {(["EN", "JP"] as const).map((l) => (
            <button
              key={l}
              role="tab"
              aria-selected={tab === l}
              onClick={() => pick(l)}
              className={cn(
                "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
                tab === l ? "bg-surface-overlay text-ink" : "text-ink-muted hover:text-ink"
              )}
            >
              {l === "EN" ? t("tabEn") : t("tabJp")}
            </button>
          ))}
        </div>
      )}

      <ul className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((s) => {
          const mine = owned?.[s.id];
          const count = mine?.owned ?? 0;
          // Grått bara när vi VET att personen inte äger något (svaret har kommit).
          const dim = loggedIn === true && owned !== null && count === 0;
          const pct = s.total ? Math.min(100, Math.round((count / s.total) * 100)) : 0;
          const upcoming = s.total == null && s.releaseDate != null && Date.parse(s.releaseDate) > now;
          return (
            <li key={s.id}>
              <Link
                href={setPath(s)}
                className="group card-surface flex h-full flex-col overflow-hidden transition-colors hover:border-holo-cyan/40"
              >
                <div className="relative flex aspect-[16/9] items-center justify-center overflow-hidden bg-surface-overlay/50 p-3">
                  {s.logoUrl && !broken.has(s.id) ? (
                    // Vanlig <img>, inte SafeImage: SafeImage faller tillbaka på ett kortbaksida i
                    // full höjd, som sprängde rutans 16:9-mått.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.logoUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      onError={() => setBroken((b) => new Set(b).add(s.id))}
                      className={cn(
                        "h-full w-full object-contain transition duration-300",
                        dim && "opacity-40 grayscale group-hover:opacity-80 group-hover:grayscale-0"
                      )}
                    />
                  ) : (
                    <span className="line-clamp-2 text-center text-sm font-semibold text-ink-muted">{s.name}</span>
                  )}
                  {s.releaseDate && (
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] tabular-nums text-ink-muted">
                      {shortDate(s.releaseDate, locale)}
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-2.5 sm:p-3">
                  <p className={cn("line-clamp-2 text-sm font-medium leading-snug", dim ? "text-ink-muted" : "text-ink group-hover:text-holo-cyan")}>
                    {s.name}
                  </p>
                  <div className="mt-auto pt-2">
                    {s.total ? (
                      <>
                        <div className="h-1 overflow-hidden rounded-full bg-surface-overlay">
                          <div className="h-full rounded-full bg-holo-cyan transition-[width] duration-500" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-1 flex justify-between text-[11px] tabular-nums text-ink-muted">
                          <span>{t("progress", { owned: count, total: s.total })}</span>
                          {count > 0 && <span className="text-holo-cyan">{pct} %</span>}
                        </p>
                      </>
                    ) : (
                      <p className="text-[11px] text-ink-muted">
                        {upcoming && s.releaseDate ? t("releasesOn", { date: shortDate(s.releaseDate, locale) }) : t("noCardsYet")}
                      </p>
                    )}
                    <p className="mt-0.5 flex justify-between gap-2 text-[11px] text-ink-faint">
                      <span>{t("setValue")}</span>
                      <span className="tabular-nums text-ink-muted">{formatPrice(s.setValueOre)}</span>
                    </p>
                    {loggedIn && (
                      <p className="flex justify-between gap-2 text-[11px] text-ink-faint">
                        <span>{t("yourValue")}</span>
                        <span className={cn("tabular-nums", count > 0 ? "text-ink" : "text-ink-muted")}>
                          {owned === null ? "…" : formatPrice(mine?.valueOre ?? 0)}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
