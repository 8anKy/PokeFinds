"use client";

/**
 * FAKTAPANELEN — fyller ytan under produktbilden på DESKTOP (dold på mobil,
 * där arket tar över direkt under scenen).
 *
 * Höjden är INTE panelens egen: vänsterspalten sträcks till högerspaltens höjd
 * och panelen ligger ABSOLUT under bildbrunnen (product-detail-view.tsx), ur
 * flödet. Underkanten ligger därför ALLTID i linje med prishistorikkortets
 * underkant, oavsett hur många rader den har — får innehållet inte plats kapas
 * det nedtill (`overflow-hidden`), i prioritetsordning: innehållslistan/
 * kortfälten först, setfakta sist. Panelen växer aldrig sidan, och den
 * renderas först när priset är hämtat (skelettet gör högerspalten för kort).
 *
 * Datat kommer ur skalet (`ProductFacts`, DB-fritt och 30 d ISR) — inget hämtas.
 */

import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProductFacts } from "@/lib/product-facts";

const LANGUAGE_KEYS = ["SV", "EN", "JP", "DE", "FR", "OTHER"];

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
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
  // `?? null`: detail-payloaden cachas ≤1 h — direkt efter en deploy saknar
  // äldre svar fältet, och panelen ska då bara utebli.
  const f = facts ?? null;
  if (!f) return null;

  const isCard = f.card != null;
  const languageLabel = LANGUAGE_KEYS.includes(f.language) ? tLang(f.language) : f.language;
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
      aria-label={isCard ? t("factsCardTitle") : t("factsSealedTitle")}
      className={cn("card-surface flex flex-col gap-3 overflow-hidden p-4", className)}
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
              <span className="text-[15px] font-semibold text-ink">{f.card.artist}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {f.card.rarity && <Fact label={t("factRarity")}>{f.card.rarity}</Fact>}
            {f.card.stage && <Fact label={t("factStage")}>{f.card.stage}</Fact>}
            {f.card.hp != null && <Fact label={t("factHp")}>{f.card.hp}</Fact>}
            {f.language !== "EN" && <Fact label={t("factLanguage")}>{languageLabel}</Fact>}
          </div>
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

      {/* SETRADEN — en kompakt rad längst ned (`mt-auto`), inte ett rutnät:
          panelens höjd är given av högerspalten (~235 px) och innehållslistan
          + ett tvåradigt faktarutnät sprängde den med ~70 px. */}
      {setLine.length > 0 && (
        <p className="mt-auto border-t border-surface-border/60 pt-3 text-[11px] leading-4 text-ink-muted">
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
