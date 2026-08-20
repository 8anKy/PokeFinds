/**
 * SETETS SAMMANSÄTTNING — tabellen på setsidan.
 *
 * REN PRESENTATION. Komponenten hämtar INGENTING: setsidan har redan korten i
 * sin `getSet`-fråga, räknar raderna med `computeSetComposition()` och skickar
 * in dem. ⛔ Lägg aldrig en `fetch`, ett `useSWR` eller en Prisma-fråga här —
 * setsidan är ISR-cachad (`revalidate = 3600`) och rutan får kosta NOLL nya
 * Neon-väckningar. Det är också därför den är en ren serverkomponent utan
 * `"use client"`: den har ingen interaktivitet, så den ska inte skicka en byte
 * JavaScript till telefonen (samma mönster som `product-card.tsx`).
 *
 * ⛔ RUTAN VISAR SAMMANSÄTTNING, ALDRIG DRAGCHANSER. Skälen står i
 * `src/lib/set-composition.ts` — kort: The Pokémon Company publicerar inga
 * sannolikheter för fysiska paket, den enda uppmätta datan är låst och täcker
 * ~20 av ~174 set, och "ett delat med antalet kort" är ingen dragchans eftersom
 * paket samlas från tryckark. Brasklappen nedan är därför INGEN fotnot: den
 * står som en egen, läsbar rad ovanför tabellen, i samma storlek som brödtexten.
 * Ta inte bort den och krymp den inte.
 *
 * ⛔ "–" BETYDER "VI VET INTE", ALDRIG "0 kr". `formatPrice(null)` ger strecket,
 * och raden under tabellen säger uttryckligen vad det betyder. En nolla hade
 * lästs som "gratis" och är den fällan hela prispolicyn är byggd för att undvika.
 */

import { useTranslations } from "next-intl";
import { formatPercent, formatPrice } from "@/lib/format";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import type { SetCompositionResult } from "@/lib/set-composition";

/**
 * Andelsstapelns minsta synliga bredd i procent.
 *
 * En sällsynthet med ett kort i ett 250-korts set är 0,4 % — en stapel på 0,4 %
 * av spåret är noll pixlar och läser som "ingen stapel alls", alltså som ett
 * renderingsfel. Golvet är rent DEKORATIVT: stapeln är `aria-hidden` och den
 * exakta siffran står i samma cell, så golvet kan inte få någon att läsa av ett
 * fel tal. ⛔ Höj det inte — då börjar stapeln ljuga om proportionerna.
 */
const MIN_BAR_PERCENT = 3;

export function SetComposition({
  composition,
}: {
  composition: SetCompositionResult;
}) {
  const t = useTranslations("SetComposition");
  const { rows, cardCount, pricedCardCount } = composition;

  // Ett rent sealed-set (inga kort) har ingen sammansättning att visa. Tyst
  // ingenting är rätt svar — en tom tabell vore ett löfte utan innehåll.
  if (rows.length === 0 || cardCount === 0) return null;

  return (
    <section className="mt-10" aria-labelledby="set-composition-title">
      {/* ⛔ Ingen egen `px-*` här: sidans vågräta luft (`px-2.5 sm:px-6`) ägs av
          setsidans behållare. Lägger rutan på ett eget mått hamnar den ur linje
          med rutnätet nedanför. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2
          id="set-composition-title"
          className="font-display text-lg font-bold text-ink"
        >
          {t("title")}
        </h2>
        <p className="text-sm tabular-nums text-ink-muted">
          {t("summary", { cards: cardCount, rarities: rows.length })}
        </p>
      </div>

      <p className="mt-1 text-sm text-ink-muted">{t("intro")}</p>

      {/* BRASKLAPPEN — synlig rad, inte fotnot. Accentkanten gör den till en
          egen läsenhet utan att skrika; texten står i brödtextstorlek. */}
      <div className="mt-3 border-l-2 border-holo-cyan/50 pl-3">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          {t("disclaimer")}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-faint">
          {t("affiliation")}
        </p>
      </div>

      {/* `Table` bär redan `overflow-x-auto` runt sig själv, så en lång
          sällsynthetsetikett ("Special Illustration Rare") får tabellen att
          scrolla I SIN EGEN behållare i stället för att dra hela sidan i
          sidled. ⛔ Den regeln är hela skälet till att etiketten får vara
          `whitespace-nowrap` nedan — namnet kortas aldrig av. */}
      <Table className="mt-4">
        <THead>
          <TR>
            <TH className="px-2.5 py-2.5 lg:px-4 lg:py-3">{t("colRarity")}</TH>
            <TH className="px-2.5 py-2.5 text-right lg:px-4 lg:py-3">
              {t("colCount")}
            </TH>
            <TH className="px-2.5 py-2.5 text-right lg:px-4 lg:py-3">
              {t("colShare")}
            </TH>
            <TH className="px-2.5 py-2.5 text-right lg:px-4 lg:py-3">
              {t("colMedian")}
            </TH>
            <TH className="px-2.5 py-2.5 text-right lg:px-4 lg:py-3">
              {t("colTotal")}
            </TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => {
            const sharePercent = row.share * 100;
            return (
              <TR key={row.rarity ?? "__unknown__"}>
                <TD className="px-2.5 py-2.5 lg:px-4 lg:py-3">
                  <span className="block whitespace-nowrap text-[13px] font-medium text-ink lg:text-sm">
                    {/* ⛔ `null` översätts HÄR — beräkningen hittar aldrig på
                        ett namn på en sällsynthet katalogen inte har. */}
                    {row.rarity ?? t("unknownRarity")}
                  </span>
                  {/* Delvis prisdata sägs rakt ut i stället för att medianen
                      tyst påstår sig gälla hela raden (samma ärlighet som
                      samlingens "snitt 400 kr · 1 av 4"). */}
                  {row.pricedCount < row.count && (
                    <span className="mt-0.5 block whitespace-nowrap text-[11px] tabular-nums text-ink-faint">
                      {t("pricedOf", {
                        priced: row.pricedCount,
                        count: row.count,
                      })}
                    </span>
                  )}
                </TD>

                <TD className="px-2.5 py-2.5 text-right text-[13px] font-semibold tabular-nums text-ink lg:px-4 lg:py-3 lg:text-sm">
                  {row.count}
                </TD>

                <TD className="px-2.5 py-2.5 text-right text-[13px] tabular-nums text-ink lg:px-4 lg:py-3 lg:text-sm">
                  {formatPercent(sharePercent, false)}
                  {/* ⛔ Spåret målas på `surface-overlay` — `surface` och
                      `surface-raised` är BÅDA #000000, så ett spår där hade
                      varit osynligt. Stapeln är dekor: `aria-hidden`, siffran
                      ovanför är sanningen. */}
                  <span
                    aria-hidden="true"
                    className="ml-auto mt-1.5 block h-1 w-12 overflow-hidden rounded-full bg-surface-overlay lg:w-20"
                  >
                    <span
                      className="block h-full rounded-full bg-holo-cyan"
                      style={{
                        width: `${Math.min(100, Math.max(MIN_BAR_PERCENT, sharePercent))}%`,
                      }}
                    />
                  </span>
                </TD>

                <TD
                  className={`px-2.5 py-2.5 text-right text-[13px] tabular-nums lg:px-4 lg:py-3 lg:text-sm ${
                    row.medianPriceOre === null ? "text-ink-faint" : "text-ink"
                  }`}
                >
                  {formatPrice(row.medianPriceOre)}
                </TD>

                <TD
                  className={`px-2.5 py-2.5 text-right text-[13px] tabular-nums lg:px-4 lg:py-3 lg:text-sm ${
                    row.totalPriceOre === null ? "text-ink-faint" : "text-ink-muted"
                  }`}
                >
                  {formatPrice(row.totalPriceOre)}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      <p className="mt-2 text-xs leading-relaxed text-ink-faint">
        {t("dashMeansUnknown")}
        {pricedCardCount < cardCount && (
          <>
            {" "}
            {t("pricedCoverage", { priced: pricedCardCount, total: cardCount })}
          </>
        )}
      </p>
    </section>
  );
}
