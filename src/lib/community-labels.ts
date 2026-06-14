import type { PostCategory } from "@prisma/client";
import type { BadgeVariant } from "@/components/ui/badge";

/** Svenska etiketter för communityts kategorier. */
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
