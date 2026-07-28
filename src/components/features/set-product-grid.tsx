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
import { Label, Select } from "@/components/ui/input";
import { compareCardNumbers } from "@/lib/card-number-order";

type Product = ProductCardProps["product"] & { id: string };

/** Värdena motsvarar ProductSort-nycklarna i services/products.ts (samma etiketter). */
type SetSort = "popular" | "card_number_asc" | "card_number_desc";
const SET_SORTS: SetSort[] = ["popular", "card_number_asc", "card_number_desc"];

export function SetProductGrid({ products }: { products: Product[] }) {
  const t = useTranslations("Products");
  const [sort, setSort] = useState<SetSort>("popular");

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

  return (
    <>
      <div className="mt-8 flex items-center justify-end gap-2">
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

      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {sorted.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </>
  );
}
