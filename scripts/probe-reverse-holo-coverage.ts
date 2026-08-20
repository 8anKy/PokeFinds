/**
 * Per EN-set: hur väl täcker vår produktkatalog reverse holo-tryckningarna?
 * Avgör om en MASTER SET-nämnare vore ärlig eller en lögn. Läser bara.
 */
import { prisma } from "../src/lib/db";

// Sällsyntheter som HAR en reverse holo i moderna set (grov, redovisas som sådan).
const RH_ELIGIBLE = new Set([
  "Common", "Uncommon", "Rare", "Rare Holo", "Double Rare", "Rare Holo V", "Rare Holo EX",
]);

async function main() {
  const sets = await prisma.cardSet.findMany({
    where: { language: "EN" },
    select: { id: true, name: true, releaseDate: true, totalCards: true, _count: { select: { cards: true } } },
    orderBy: { releaseDate: "desc" },
  });
  const cards = await prisma.card.findMany({
    where: { set: { language: "EN" } },
    select: { id: true, setId: true, rarity: true },
  });
  const rhProducts = await prisma.product.findMany({
    where: { category: "SINGLE_CARD", cardId: { not: null }, variantLabel: { contains: "Reverse", mode: "insensitive" } },
    select: { cardId: true },
  });
  const rhCards = new Set(rhProducts.map((p) => p.cardId!));

  const bySet = new Map<string, { eligible: number; withRh: number; rhOnIneligible: number }>();
  for (const c of cards) {
    const e = bySet.get(c.setId) ?? { eligible: 0, withRh: 0, rhOnIneligible: 0 };
    const elig = RH_ELIGIBLE.has(c.rarity);
    const has = rhCards.has(c.id);
    if (elig) e.eligible++;
    if (elig && has) e.withRh++;
    if (!elig && has) e.rhOnIneligible++;
    bySet.set(c.setId, e);
  }

  const rows = sets.map((s) => {
    const e = bySet.get(s.id) ?? { eligible: 0, withRh: 0, rhOnIneligible: 0 };
    return {
      name: s.name,
      date: s.releaseDate ? s.releaseDate.toISOString().slice(0, 10) : "",
      cards: s._count.cards,
      eligible: e.eligible,
      withRh: e.withRh,
      pct: e.eligible ? Math.round((e.withRh / e.eligible) * 100) : null,
      rhOnIneligible: e.rhOnIneligible,
    };
  });

  const withElig = rows.filter((r) => r.eligible >= 10);
  const buckets = { full: 0, high: 0, partial: 0, none: 0 };
  for (const r of withElig) {
    const p = r.pct ?? 0;
    if (p >= 98) buckets.full++;
    else if (p >= 80) buckets.high++;
    else if (p > 0) buckets.partial++;
    else buckets.none++;
  }
  console.log("=== SAMMANFATTNING (EN-set med >=10 RH-berättigade kort: " + withElig.length + ") ===");
  console.log(JSON.stringify(buckets, null, 2));
  console.log("totala RH-berättigade kort:", withElig.reduce((a, r) => a + r.eligible, 0));
  console.log("varav med RH-produkt:", withElig.reduce((a, r) => a + r.withRh, 0));
  console.log("\n=== PER SET (nyast först) ===");
  for (const r of rows)
    console.log(`  ${String(r.pct ?? "-").padStart(4)}%  RH ${String(r.withRh).padStart(4)}/${String(r.eligible).padStart(4)}  kort=${String(r.cards).padStart(4)}  extraRH=${r.rhOnIneligible}  ${r.date}  ${r.name}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
