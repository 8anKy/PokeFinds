"use client";

/**
 * Setsidans produktrutnät med sortering.
 *
 * KLIENT-SIDA MED FLIT. Setsidan är ISR-cachad (`revalidate = 3600`) och läser
 * med flit INGA searchParams — gjorde den det skulle hela rutten bli dynamisk
 * igen, vilket var precis det som drev upp Neon-CU:n (se "Caching/ISR" i
 * CLAUDE.md). Hela setet är dessutom redan hämtat i serverkomponenten (inget
 * `take`), så sorteringen kräver varken ny fråga eller ny sidladdning.
 *
 * Ordningen som kommer in från servern (populärast först) är kvar som standard;
 * kortnummer är ett VAL. Setsidan är ju ofta ingången från sök, och då är det
 * mest efterfrågade kortet överst rimligare än nummer 1 i setet.
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ProductCard, type ProductCardProps } from "@/components/features/product-card";
import { Checkbox, Label, Select } from "@/components/ui/input";
import { compareCardNumbers } from "@/lib/card-number-order";
import { useSetCompletion } from "@/lib/set-completion";

/** `cardId` = kortets id (null för sealed) — nyckeln "visa bara saknade" filtrerar på. */
type Product = ProductCardProps["product"] & { id: string; cardId: string | null };

/** Värdena motsvarar ProductSort-nycklarna i services/products.ts (samma etiketter). */
type SetSort = "popular" | "card_number_asc" | "card_number_desc";
const SET_SORTS: SetSort[] = ["popular", "card_number_asc", "card_number_desc"];

export function SetProductGrid({
  setId,
  products,
}: {
  setId: string;
  products: Product[];
}) {
  const t = useTranslations("Products");
  const tc = useTranslations("SetCompletion");
  const [sort, setSort] = useState<SetSort>("popular");
  const [onlyMissing, setOnlyMissing] = useState(false);

  // Ingen extra hämtning: samma delade anrop som progressraden redan gjort
  // (`lib/set-completion.ts` dedupar), och sidan har korten renderade sedan
  // servern — filtret är rent klient-sida. `null` när setet inte har några
  // kort-produkter alls, då hoppas anropet över helt.
  const hasCards = useMemo(() => products.some((p) => p.cardId), [products]);
  const completion = useSetCompletion(hasCards ? setId : null);
  const canFilter = !!completion && completion.ownedCount > 0;

  const sorted = useMemo(() => {
    if (sort === "popular") return products; // serverns ordning, orörd
    const dir = sort === "card_number_asc" ? 1 : -1;
    // Kopia — sortera aldrig propsen på plats (React återanvänder arrayen mellan
    // renderingar, och "populärast" ska gå att välja tillbaka).
    return [...products].sort((a, b) => {
      // Sealed i ett set (ETB, boosterboxar) har inget kortnummer → sist i BÅDA
      // riktningarna. En låda ska inte inleda listan bara för att man vände på den.
      if (!a.cardNumber && !b.cardNumber) return 0;
      if (!a.cardNumber) return 1;
      if (!b.cardNumber) return -1;
      return compareCardNumbers(a.cardNumber, b.cardNumber) * dir;
    });
  }, [products, sort]);

  // ⛔ Sealed (utan `cardId`) faller bort när filtret är på: en boosterbox är
  // inget kort man "saknar" i setet, och att låta lådorna ligga kvar hade gjort
  // listan till "saknade kort + allt annat".
  const visible = useMemo(() => {
    if (!onlyMissing || !completion) return sorted;
    return sorted.filter((p) => p.cardId && !completion.ownedCardIds.has(p.cardId));
  }, [sorted, onlyMissing, completion]);

  return (
    <>
      <div className="mt-8 flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        {/* Bara meningsfullt för den som redan äger något i setet — annars är
            "visa bara saknade" samma lista som redan visas. */}
        {canFilter && (
          // Wrappern bär `mr-auto`, inte checkboxen: `className` i Checkbox går
          // till <input>, och etiketten är ett syskon inuti dess <label>.
          <div className="mr-auto">
            <Checkbox
              id="set-only-missing"
              label={tc("showMissingOnly")}
              checked={onlyMissing}
              onChange={(e) => setOnlyMissing(e.target.checked)}
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          <Label htmlFor="set-sort" className="whitespace-nowrap text-sm text-ink-muted">
            {t("sortBy")}
          </Label>
          <Select
            id="set-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SetSort)}
            className="w-auto min-w-[13rem]"
          >
            {SET_SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`sort.${s}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="mt-10 text-center text-sm text-ink-muted">{tc("noneMissing")}</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-3.5 xl:grid-cols-4">
          {/* De första fyra = rutnätets 2×2 ovanför vecket på telefon (en hel rad
              på xl). Deras bilder hämtas direkt i stället för lazy — se SafeImage.
              ⛔ Höj inte talet: flaggan är en KÖ, så markeras allt är ingenting
              prioriterat och den första bilden blir långsammare än utan flaggan. */}
          {visible.map((p, i) => (
            <ProductCard key={p.id} product={p} priority={i < 4} />
          ))}
        </div>
      )}
    </>
  );
}
