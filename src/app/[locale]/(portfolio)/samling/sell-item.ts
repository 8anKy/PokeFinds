import type { SellItem } from "@/components/features/sell-sheet";
import type { CollectionRow } from "./collection-client";

/**
 * Samlingsrad → säljarkets indata. Arket vet med flit ingenting om
 * `CollectionRow` (skannern har en helt annan datakälla), så översättningen
 * bor här, hos den som faktiskt har raden.
 */
export function toSellItem(row: CollectionRow, stack: readonly CollectionRow[] = [row]): SellItem {
  return {
    key: row.id,
    collectionItemId: row.id,
    name: row.name,
    setName: row.setName,
    imageUrl: row.imageUrl,
    condition: row.condition,
    language: row.language,
    estimatedValue: row.estimatedValue,
    // Ett löst kort har ett kort-id; en förseglad produkt har bara produkt-id.
    isSingle: row.cardId != null,
    gradingCompany: row.gradingCompany,
    grade: row.grade,
    slug: row.slug,
    // Ett exemplar per rad (ett köp med antal 2 = två rader): en annons är alltid
    // ETT exemplar, och arket låter användaren välja vilket.
    copies: stack.flatMap((l) =>
      Array.from({ length: l.quantity }, (_, n) => ({
        key: `${l.id}:${n}`,
        collectionItemId: l.id,
        purchasePrice: l.purchasePrice,
        purchaseDate: l.purchaseDate,
        addedAt: l.addedAt ?? null,
        // Ett utlagt köp bär annonsens nummer; sedan 2026-10-05 delas utlagda
        // exemplar ut till en egen post, så det är just det exemplaret.
        listed: l.traderaListed === true,
      }))
    ),
  };
}
