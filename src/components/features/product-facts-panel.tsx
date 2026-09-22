"use client";

/**
 * FAKTAPANELEN — fyller ytan under produktbilden på DESKTOP (dold på mobil,
 * där arket tar över direkt under scenen).
 *
 * Höjden är INTE panelens egen: vänsterspalten sträcks till högerspaltens höjd
 * och panelen ligger ABSOLUT under bildbrunnen (product-detail-view.tsx), ur
 * flödet. Underkanten ligger därför ALLTID i linje med prishistorikkortets
 * underkant, oavsett hur många rader den har. Får allt inte plats döljs raderna
 * NIVÅVIS (`data-fit`, CSS i globals.css) — aldrig en kapad rad: nivå 1 =
 * kärnfakta, nivå 2 = regulation mark/Pokédex + setraden, nivå 3 = flavour text.
 * ⛔ NIVÅN MÄTS, den gissas inte (2026-09-22). Den var en container-fråga på
 * fasta höjder (260/330 px) som bara räknade med KORTENS rader — förseglat hade
 * ingen nivå alls, och en ETB-lista med 12 rader + en setrad på två rader kapades
 * nedtill när högerspalten var låg. Nu provas nivåerna mot panelens verkliga
 * höjd; får inte ens kärnan plats döljs hela panelen (`visibility`, så att
 * ResizeObservern fortsätter mäta och tar tillbaka den när spalten växer). Panelen växer aldrig sidan, och den renderas först när
 * priset är hämtat (skelettet gör högerspalten för kort).
 *
 * Datat kommer ur skalet (`ProductFacts`, DB-fritt och 30 d ISR) — inget hämtas.
 * Singlar med färre än `MIN_CARD_FACTS` fakta får ingen panel alls (product-facts.ts).
 */

import { useLayoutEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProductFacts } from "@/lib/product-facts";

const LANGUAGE_KEYS = ["SV", "EN", "JP", "DE", "FR", "OTHER"];
/** Energityperna som källorna stavar dem — nyckel i `Detail.energyType.*`. */
const ENERGY_TYPES = [
  "Grass",
  "Fire",
  "Water",
  "Lightning",
  "Psychic",
  "Fighting",
  "Darkness",
  "Metal",
  "Dragon",
  "Fairy",
  "Colorless",
];

function Fact({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="text-[11px] text-ink-faint">{label}</span>
      <span className="truncate text-xs text-ink">{children}</span>
    </div>
  );
}

export function ProductFactsPanel({
  facts,
  categoryLabel,
  className,
}: {
  facts: ProductFacts | null | undefined;
  categoryLabel: string;
  className?: string;
}) {
  const t = useTranslations("Detail");
  const tLang = useTranslations("Language");
  const locale = useLocale();
  const ref = useRef<HTMLElement>(null);
  const [fit, setFit] = useState(0);
  // Minsta nivå där innehållet ryms. Nivån sätts på elementet FÖRE mätningen
  // (synkront, samma bildruta) — React skriver sedan samma värde via `data-fit`.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      for (let level = 0; level <= 2; level++) {
        el.dataset.fit = String(level);
        if (el.scrollHeight <= el.clientHeight + 1) {
          setFit(level);
          return;
        }
      }
      el.dataset.fit = "3";
      setFit(3);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [facts]);
  // `?? null`: detail-payloaden cachas ≤1 h — direkt efter en deploy saknar
  // äldre svar fältet, och panelen ska då bara utebli.
  const f = facts ?? null;
  if (!f) return null;

  const isCard = f.card != null;
  // Skal från förra epoken kan sakna de nyare kortfälten — aldrig ett kast här.
  const cardTypes = f.card?.types ?? [];
  const languageLabel = LANGUAGE_KEYS.includes(f.language) ? tLang(f.language) : f.language;
  const energy = (type: string) => (ENERGY_TYPES.includes(type) ? t(`energyType.${type}`) : type);
  const cardNumber =
    f.card && f.card.printedTotal > 0 ? `${f.card.number}/${f.card.printedTotal}` : f.card?.number ?? null;
  const setLine: string[] = [];
  if (f.series) setLine.push(f.series);
  if (f.releaseDate) setLine.push(`${t("factReleased")} ${formatDate(f.releaseDate, locale)}`);
  if (f.setCards) {
    setLine.push(
      f.setCards.full > f.setCards.printed
        ? t("factSetCardsLine", { printed: f.setCards.printed, full: f.setCards.full })
        : t("factSetCardsLineShort", { printed: f.setCards.printed })
    );
  }
  if (!isCard && f.language !== "EN") setLine.push(languageLabel);

  return (
    <section
      ref={ref}
      data-fit={fit}
      aria-label={isCard ? t("factsCardTitle") : t("factsSealedTitle")}
      className={cn("facts-panel card-surface flex flex-col gap-2.5 overflow-hidden p-4", className)}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-ink">{isCard ? t("factsCardTitle") : t("factsSealedTitle")}</h2>
        <span className="truncate text-[11px] text-ink-faint">{isCard ? cardNumber : categoryLabel}</span>
      </div>

      {f.card && (
        <>
          {f.card.artist && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-ink-faint">{t("factArtist")}</span>
              <span className="truncate text-[15px] font-semibold text-ink">{f.card.artist}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {f.card.rarity && <Fact label={t("factRarity")}>{f.card.rarity}</Fact>}
            {cardTypes.length > 0 && <Fact label={t("factType")}>{cardTypes.map(energy).join(" · ")}</Fact>}
            {f.card.stage && <Fact label={t("factStage")}>{f.card.stage}</Fact>}
            {f.card.hp != null && <Fact label={t("factHp")}>{f.card.hp}</Fact>}
            {f.card.weakness && (
              <Fact label={t("factWeakness")}>
                {energy(f.card.weakness.type)}
                {f.card.weakness.value ? ` ${f.card.weakness.value}` : ""}
              </Fact>
            )}
            {f.card.retreatCost != null && <Fact label={t("factRetreat")}>{f.card.retreatCost}</Fact>}
            {f.card.regulationMark && (
              <Fact label={t("factRegulationMark")} className="facts-t2">
                {f.card.regulationMark}
              </Fact>
            )}
            {f.card.dexId != null && (
              <Fact label={t("factDex")} className="facts-t2">
                #{f.card.dexId}
              </Fact>
            )}
            {f.language !== "EN" && <Fact label={t("factLanguage")}>{languageLabel}</Fact>}
          </div>
          {f.card.flavorText && (
            <p className="facts-t3 line-clamp-2 text-[11px] italic leading-4 text-ink-muted">{f.card.flavorText}</p>
          )}
        </>
      )}

      {f.contents && f.contents.length > 0 && (
        <ul className={cn("grid gap-x-3 gap-y-1 text-[13px] text-ink", f.contents.length > 5 ? "grid-cols-2" : "grid-cols-1")}>
          {f.contents.map((line) => (
            <li key={line.key} className="flex items-baseline gap-2.5">
              <span className="w-7 shrink-0 text-right font-bold tabular-nums text-holo-cyan">{line.qty}</span>
              <span className="min-w-0 truncate">{t(`contents.${line.key === "boosters" && line.qty === 1 ? "boostersOne" : line.key}`)}</span>
            </li>
          ))}
        </ul>
      )}

      {/* SETRADEN — en kompakt rad längst ned (`mt-auto`), inte ett rutnät. */}
      {setLine.length > 0 && (
        <p className="facts-t2 mt-auto border-t border-surface-border/60 pt-2.5 text-[11px] leading-4 text-ink-muted">
          {setLine.map((part, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-1.5 text-ink-faint" aria-hidden="true">·</span>}
              {part}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
