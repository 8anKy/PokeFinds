import type { SellItem } from "@/components/features/sell-sheet";
import type { CollectionRow } from "./collection-client";

/**
 * Samlingsrad → säljarkets indata. Arket vet med flit ingenting om
 * `CollectionRow` (skannern har en helt annan datakälla), så översättningen
 * bor här, hos den som faktiskt har raden.
 */
export function toSellItem(row: CollectionRow): SellItem {
  return {
    collectionItemId: row.id,
    name: row.name,
    setName: row.setName,
    imageUrl: row.imageUrl,
    condition: row.condition,
    language: row.language,
    estimatedValue: row.estimatedValue,
    // Ett löst kort har ett kort-id; en förseglad produkt har bara produkt-id.
    isSingle: row.cardId != null,
    slug: row.slug,
  };
}
