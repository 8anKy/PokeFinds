import type { ListingKind, ListingStatus, PostCategory } from "@prisma/client";
import type { BadgeVariant } from "@/components/ui/badge";

/** Svenska etiketter för communityts kategorier (legacy — trådar före grupperna). */
export const POST_CATEGORY_LABELS: Record<PostCategory, string> = {
  PULLS: "Pulls",
  TRADES: "Byten",
  QUESTIONS: "Frågor",
  MARKET: "Marknad",
  NEWS: "Nyheter",
  COLLECTIONS: "Samlingar",
};

export const POST_CATEGORY_VARIANTS: Record<PostCategory, BadgeVariant> = {
  PULLS: "holo",
  TRADES: "info",
  QUESTIONS: "default",
  MARKET: "success",
  NEWS: "warning",
  COLLECTIONS: "info",
};

export function isPostCategory(value: string): value is PostCategory {
  return value in POST_CATEGORY_LABELS;
}

// ---------- Köp/Sälj/Byt ----------
//
// Etiketterna bor i messages (`Forum.kindSell` …) — här bara nycklarna och
// badge-varianterna, så server- och klientkomponenter färgsätter lika.

export const LISTING_KIND_KEYS: Record<ListingKind, "kindSell" | "kindBuy" | "kindTrade"> = {
  SELL: "kindSell",
  BUY: "kindBuy",
  TRADE: "kindTrade",
};

export const LISTING_KIND_VARIANTS: Record<ListingKind, BadgeVariant> = {
  SELL: "success",
  BUY: "info",
  TRADE: "warning",
};

export const LISTING_STATUS_KEYS: Record<
  ListingStatus,
  "statusActive" | "statusSold" | "statusClosed"
> = {
  ACTIVE: "statusActive",
  SOLD: "statusSold",
  CLOSED: "statusClosed",
};

export const LISTING_STATUS_VARIANTS: Record<ListingStatus, BadgeVariant> = {
  ACTIVE: "holo",
  SOLD: "default",
  CLOSED: "default",
};
