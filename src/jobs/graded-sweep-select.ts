/**
 * VILKA KORT DE GRADERADE SVEPEN TAR I NATT (2026-10-15) — delad av eBay-sålt
 * (`ebay-sold-sweep`) och eBay-begärt (`graded-ask-sweep`).
 *
 * VARFÖR: båda roterade på "äldst kollad först" över HELA katalogen (~53 500 kort).
 * Mätt 2026-10-15:
 *  - Mega Darkrai ex 116 (Pitch Black, 106 visningar/30 d) var senast kollad
 *    2026-09-15 i båda svepen. Begärt-raderna (PSA/CGC/ACE/TAG fanns!) var 30 dygn
 *    gamla och döljs efter 14 ⇒ produktsidan visade INGA graderade priser.
 *  - Begärt-svepet låg nere 09-15 → 10-06 (401) och har sedan dess bara betat
 *    21 880 aldrig-kollade kort (nulls first) — de populära kom aldrig tillbaka.
 *  - Träffarna sitter i de dyra korten: < 20 kr (31 664 kort) gav eBay-affärer på
 *    0,8 %, 50–100 kr på 29 %, ≥ 200 kr på 42 %. Rotationen lade alltså ~60 % av
 *    budgeten på kort som nästan aldrig graderas.
 *
 * NIVÅER, i ordning, tills budgeten är slut:
 *  1. Bevakade kort + kort någon äger GRADERADE — varje natt.
 *  2. HETA: visade senaste 30 d (`viewCount` > 0, ~1 100 kort), inte kollade på
 *     `HOT_RECHECK_DAYS` — mest visade först.
 *  3. VÄRDEFULLA: lägsta pris ≥ 50 kr (~12 800 kort), äldst kollad först.
 *  4. SVANSEN: resten, äldst kollad först — med en reserverad andel så att den
 *     aldrig svälts helt (ett billigt kort kan bli dyrt).
 *
 * KOSTNAD: noll nya anrop — samma budgetar, bättre urval. Fyra id-frågor i ett
 * fönster där Neon redan är vaken.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { OWNED_GRADED_PRODUCT_WHERE } from "../lib/graded-value";

export const HOT_RECHECK_DAYS = 3;
export const VALUABLE_MIN_ORE = 5_000;
export const TAIL_SHARE = 0.15;

export type GradedCheckedField = "gradedAskCheckedAt" | "ebaySoldCheckedAt";

export async function selectGradedSweepIds(opts: {
  baseWhere: Prisma.ProductWhereInput;
  field: GradedCheckedField;
  budget: number;
  tag: string;
  now?: Date;
}): Promise<string[]> {
  const { baseWhere, field, budget, tag } = opts;
  const now = opts.now ?? new Date();
  const ids: string[] = [];
  const oldestFirst: Prisma.ProductOrderByWithRelationInput[] = [
    { [field]: { sort: "asc", nulls: "first" } },
    { viewCount: "desc" },
  ];

  const take = async (
    where: Prisma.ProductWhereInput,
    orderBy: Prisma.ProductOrderByWithRelationInput[],
    n: number
  ): Promise<number> => {
    if (n <= 0) return 0;
    const rows = await prisma.product.findMany({
      where: { AND: [baseWhere, where, ids.length ? { id: { notIn: ids } } : {}] },
      select: { id: true },
      orderBy,
      take: n,
    });
    for (const r of rows) ids.push(r.id);
    return rows.length;
  };

  const stale = new Date(now.getTime() - HOT_RECHECK_DAYS * 86_400_000);
  const watched = await take(
    { OR: [{ watchlistItems: { some: {} } }, ...OWNED_GRADED_PRODUCT_WHERE] },
    [{ watchlistItems: { _count: "desc" } }, { viewCount: "desc" }],
    budget
  );
  const hot = await take(
    { viewCount: { gt: 0 }, OR: [{ [field]: null }, { [field]: { lt: stale } }] },
    [{ viewCount: "desc" }],
    budget - ids.length
  );
  const tailReserve = Math.floor(budget * TAIL_SHARE);
  const valuable = await take(
    { lowestPriceOre: { gte: VALUABLE_MIN_ORE } },
    oldestFirst,
    budget - ids.length - tailReserve
  );
  const tail = await take({}, oldestFirst, budget - ids.length);

  console.log(
    `[${tag}] ${ids.length} kort: ${watched} bevakade/ägda graderade + ${hot} heta + ${valuable} värdefulla (≥ ${VALUABLE_MIN_ORE / 100} kr) + ${tail} svans, budget ${budget}.`
  );
  return ids;
}

/** Hämta raderna för id:na i URVALETS ordning (findMany med `in` ger ingen ordning). */
export function inIdOrder<T extends { id: string }>(ids: readonly string[], rows: readonly T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    return r ? [r] : [];
  });
}
