"use client";

/**
 * /sets (omgjord 2026-10-16 efter ägarens feedback: "för stort och klumpigt").
 *
 * Kompakta rutor grupperade per ERA (`lib/set-era.ts`) med en era-räls till vänster på
 * desktop (chips på mobil), sök på setnamn och "Bara mina set". Scoutrs egna grepp:
 *  · eran visar ÅRSSPANNET och hur många set du påbörjat i den,
 *  · framsteget är en foliekant längst ned på loggan; ett KOMPLETT set får foliekant runt
 *    hela rutan,
 *  · grått = inloggad och äger inget ur setet (utloggade ser färg — sidan är också en
 *    ingång från sök).
 *
 * ⛔ KLICK ⇒ UTFORSKA MED SETET VALT (ägarbeslut 2026-10-16), men länkens href är kvar på
 * setsidan: setsidorna är sökmotorernas väg in till produkterna (`/produkter?…` är spärrad i
 * robots.txt). Vanligt klick fångas och navigerar till `/produkter?set=<id>`; ctrl/⌘-klick
 * och mittenklick öppnar setsidan som vanligt.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { setPath } from "@/lib/set-slug";
import { cn } from "@/lib/utils";
import { formatKrWhole, useOwnedSets, type OwnedBySet } from "@/lib/owned-sets";
import { eraRank, type Era } from "@/lib/set-era";
import { IconSearch } from "@/components/ui/icons";
import type { SetTile } from "@/services/sets-gallery";

const TAB_KEY = "scoutr:sets-tab";

function eraId(era: Era): string {
  return `era-${era.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function yearSpan(sets: SetTile[]): string {
  const ys = sets.map((s) => (s.releaseDate ? new Date(s.releaseDate).getUTCFullYear() : null)).filter((y): y is number => y != null);
  if (!ys.length) return "";
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

function Tile({
  s,
  owned,
  loggedIn,
  locale,
  onOpen,
}: {
  s: SetTile;
  owned: OwnedBySet | null;
  loggedIn: boolean | null;
  locale: string;
  onOpen: (e: MouseEvent<HTMLAnchorElement>, s: SetTile) => void;
}) {
  const t = useTranslations("Sets");
  const [broken, setBroken] = useState(false);
  const mine = owned?.[s.id];
  const count = mine?.owned ?? 0;
  const dim = loggedIn === true && owned !== null && count === 0;
  const pct = s.total ? Math.min(100, (count / s.total) * 100) : 0;
  const complete = s.total != null && count > 0 && count >= s.total;
  const upcoming = s.total == null && s.releaseDate != null && Date.parse(s.releaseDate) > Date.now();
  const date = s.releaseDate
    ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "sv-SE", { month: "short", year: "numeric" }).format(new Date(s.releaseDate))
    : null;

  return (
    <li>
      <Link
        href={setPath(s)}
        onClick={(e) => onOpen(e, s)}
        className={cn(
          "group flex h-full flex-col overflow-hidden rounded-xl border transition-colors",
          complete
            ? "border-transparent [background:linear-gradient(#000,#000)_padding-box,linear-gradient(120deg,#2dd4bf,#a78bfa,#f472b6)_border-box]"
            : "border-surface-border hover:border-holo-cyan/50"
        )}
      >
        <div className="relative aspect-[2/1] overflow-hidden bg-surface-overlay/40 transition-colors group-hover:bg-surface-overlay/70">
          {s.logoUrl && !broken ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={s.logoUrl}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setBroken(true)}
              className={cn(
                // Absolut i 2:1-rutan: en hög bild (produktfoto i stället för logga) får aldrig
                // spränga rutans höjd.
                "absolute inset-0 h-full w-full object-contain px-4 py-2.5 transition duration-300 group-hover:scale-[1.04]",
                dim && "opacity-35 grayscale group-hover:opacity-90 group-hover:grayscale-0"
              )}
            />
          ) : (
            <span className="absolute inset-0 grid place-items-center px-3 text-center text-xs font-semibold text-ink-muted">{s.name}</span>
          )}
          {count > 0 && s.total && (
            <span className="absolute inset-x-0 bottom-0 h-[3px] bg-surface-overlay">
              <span
                className="block h-full bg-gradient-to-r from-holo-cyan via-holo-violet to-holo-pink"
                style={{ width: `${pct}%` }}
              />
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-0.5 px-2.5 py-2">
          <p className={cn("line-clamp-1 text-[13px] font-semibold leading-snug", dim ? "text-ink-muted" : "text-ink group-hover:text-holo-cyan")}>
            {s.name}
          </p>
          <p className="flex items-baseline justify-between gap-2 text-[11px] tabular-nums text-ink-faint">
            <span className={cn(count > 0 && "text-holo-cyan")}>
              {s.total
                ? loggedIn
                  ? `${count}/${s.total}`
                  : t("cards", { count: s.total })
                : upcoming
                  ? t("upcoming")
                  : t("noCardsYet")}
            </span>
            <span>{date}</span>
          </p>
          <p className="flex items-baseline justify-between gap-2 text-[11px] tabular-nums">
            <span className="text-ink-faint">{count > 0 ? t("yourValueShort") : t("setValue")}</span>
            <span className={count > 0 ? "font-medium text-ink" : "text-ink-muted"}>
              {formatKrWhole(count > 0 ? (mine?.valueOre ?? 0) : s.setValueOre, locale)}
            </span>
          </p>
        </div>
      </Link>
    </li>
  );
}

export function SetsGallery({ sets }: { sets: SetTile[] }) {
  const t = useTranslations("Sets");
  const locale = useLocale();
  const router = useRouter();
  const { loggedIn, owned } = useOwnedSets();
  const [tab, setTab] = useState<"EN" | "JP">("EN");
  const [q, setQ] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [activeEra, setActiveEra] = useState<string | null>(null);
  const sectionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(TAB_KEY) === "JP") setTab("JP");
    } catch {
      /* privat läge */
    }
  }, []);

  function pickTab(next: "EN" | "JP") {
    setTab(next);
    try {
      window.localStorage.setItem(TAB_KEY, next);
    } catch {
      /* privat läge */
    }
  }

  const counts = useMemo(
    () => ({ EN: sets.filter((s) => s.language === "EN").length, JP: sets.filter((s) => s.language === "JP").length }),
    [sets]
  );

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shown = sets.filter(
      (s) =>
        s.language === tab &&
        (!needle || s.name.toLowerCase().includes(needle)) &&
        (!onlyMine || (owned?.[s.id]?.owned ?? 0) > 0)
    );
    const by = new Map<Era, SetTile[]>();
    for (const s of shown) (by.get(s.era) ?? by.set(s.era, []).get(s.era)!).push(s);
    return [...by.entries()]
      .sort((a, b) => eraRank(a[0]) - eraRank(b[0]))
      .map(([era, list]) => ({ era, list, started: list.filter((s) => (owned?.[s.id]?.owned ?? 0) > 0).length }));
  }, [sets, tab, q, onlyMine, owned]);

  // Scrollspy: vilken era är överst i bild — markeras i rälsen.
  useEffect(() => {
    const root = sectionsRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActiveEra(top.target.id);
      },
      { rootMargin: "-80px 0px -60% 0px" }
    );
    root.querySelectorAll("section[id^='era-']").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [groups]);

  function open(e: MouseEvent<HTMLAnchorElement>, s: SetTile) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    router.push(`/produkter?set=${encodeURIComponent(s.id)}`);
  }

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const startedTotal = owned ? sets.filter((s) => s.language === tab && (owned[s.id]?.owned ?? 0) > 0).length : 0;

  return (
    <div className="mt-6">
      {/* Kontrollrad: språkflikar · sök · bara mina */}
      <div className="flex flex-col gap-3 border-b border-surface-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" className="flex gap-5">
          {(["EN", "JP"] as const).map((l) =>
            counts[l] === 0 ? null : (
              <button
                key={l}
                role="tab"
                aria-selected={tab === l}
                onClick={() => pickTab(l)}
                className={cn(
                  "relative pb-1.5 text-sm font-semibold transition-colors",
                  tab === l ? "text-ink" : "text-ink-muted hover:text-ink"
                )}
              >
                {l === "EN" ? t("tabEn") : t("tabJp")}
                <span className="ml-1.5 text-xs font-normal text-ink-faint">{counts[l]}</span>
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-0 -bottom-[13px] h-0.5 rounded-full bg-holo-cyan transition-transform",
                    tab === l ? "scale-x-100" : "scale-x-0"
                  )}
                />
              </button>
            )
          )}
        </div>
        <div className="flex items-center gap-3">
          {loggedIn && (
            <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={onlyMine}
                onChange={(e) => setOnlyMine(e.target.checked)}
                className="h-4 w-4 accent-[#2dd4bf]"
              />
              {t("onlyMine")}
            </label>
          )}
          <label className="relative block w-full sm:w-60">
            <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-full rounded-lg border border-surface-border bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-holo-cyan focus:outline-none"
            />
          </label>
        </div>
      </div>

      {loggedIn && owned && (
        <p className="mt-3 text-xs text-ink-muted">{t("startedSummary", { started: startedTotal, total: counts[tab] })}</p>
      )}

      {/* Mobil: era-chips */}
      <div className="-mx-2.5 mt-4 flex gap-2 overflow-x-auto px-2.5 pb-1 lg:hidden">
        {groups.map((g) => (
          <button
            key={g.era}
            onClick={() => jump(eraId(g.era))}
            className="shrink-0 rounded-full border border-surface-border px-3 py-1 text-xs text-ink-muted hover:text-ink"
          >
            {g.era === "Other" ? t("eraOther") : g.era}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        {/* Desktop: era-räls */}
        <nav aria-label={t("eraNav")} className="hidden lg:block">
          <div className="sticky top-24">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{t("eraNav")}</p>
            <ul className="space-y-0.5">
              {groups.map((g) => {
                const id = eraId(g.era);
                const active = activeEra === id;
                return (
                  <li key={g.era}>
                    <button
                      onClick={() => jump(id)}
                      className={cn(
                        "flex w-full items-baseline justify-between gap-2 rounded-md border-l-2 py-1 pl-2.5 pr-1 text-left text-sm transition-colors",
                        active ? "border-holo-cyan text-ink" : "border-transparent text-ink-muted hover:text-ink"
                      )}
                    >
                      <span className="truncate">{g.era === "Other" ? t("eraOther") : g.era}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                        {loggedIn && owned ? `${g.started}/${g.list.length}` : g.list.length}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>

        <div ref={sectionsRef} className="space-y-10">
          {groups.length === 0 && <p className="text-sm text-ink-muted">{t("noMatch")}</p>}
          {groups.map((g) => (
            <section key={g.era} id={eraId(g.era)} className="scroll-mt-24">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="font-display text-lg font-semibold text-ink">
                  {g.era === "Other" ? t("eraOther") : g.era}
                  <span className="ml-2 text-sm font-normal text-ink-faint">{yearSpan(g.list)}</span>
                </h2>
                {loggedIn && owned && (
                  <span className="text-xs text-ink-muted">{t("eraStarted", { started: g.started, total: g.list.length })}</span>
                )}
              </div>
              <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {g.list.map((s) => (
                  <Tile key={s.id} s={s} owned={owned} loggedIn={loggedIn} locale={locale} onOpen={open} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
