import type { SellItem } from "@/components/features/sell-sheet";
import type { CollectionRow } from "./collection-client";

/**
 * Samlingsrad → säljarkets indata. Arket vet med flit ingenting om
 * `CollectionRow` (skannern har en helt annan datakälla), så översättningen
 * bor här, hos den som faktiskt har raden.
 */
export function toSellItem(row: CollectionRow, stack?: readonly CollectionRow[]): SellItem {
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
    // Flera köp av samma vara: arket låter användaren välja VILKET köp som säljs
    // (pris + datum per köp). Ett ensamt köp har inget att välja.
    ...(stack && stack.length > 1
      ? {
          lots: stack.map((l) => ({
            collectionItemId: l.id,
            quantity: l.quantity,
            purchasePrice: l.purchasePrice,
            purchaseDate: l.purchaseDate,
            addedAt: l.addedAt ?? null,
          })),
        }
      : {}),
  };
}
