/**
 * "DET DU MISSADE" (2026-09-15, konvertering): hur många av ett GRATISKONTOS
 * bevakade produkter som fyllts på den senaste veckan. Raden visas på
 * /bevakningar och i veckobrevet — "Pro larmar direkt på varje" — och är det
 * ärligaste argumentet vi har: det hände, du bevakade det, du fick inget larm
 * (eller fick det fyra minuter sent).
 *
 * ⛔ Bara för gratiskonton och bara på en sida som redan är force-dynamic
 *    (/bevakningar) eller i ett jobb (veckobrevet) — aldrig på en ISR-sida.
 *    EN fråga, grupperad per produkt, mot ett index (productId, detectedAt).
 * ⛔ Räknar ÄKTA påfyllningar: → IN_STOCK från något annat än IN_STOCK. Samma
 *    dom som larmvägen; UNKNOWN→IN räknas inte som restock där heller.
 */
import { prisma } from "@/lib/db";

const DAY_MS = 86_400_000;

/** Antal DISTINKTA bevakade produkter med minst en påfyllning i fönstret. */
export async function countMissedRestocks(productIds: string[], days = 7): Promise<number> {
  if (productIds.length === 0) return 0;
  const grouped = await prisma.restockEvent.groupBy({
    by: ["productId"],
    where: {
      productId: { in: productIds },
      detectedAt: { gte: new Date(Date.now() - days * DAY_MS) },
      newStatus: "IN_STOCK",
      oldStatus: { in: ["OUT_OF_STOCK", "PREORDER"] },
    },
  });
  return grouped.length;
}
