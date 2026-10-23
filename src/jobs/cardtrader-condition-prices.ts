/**
 * PRIS PER SKICK — SKRIVS AV REVERSE-PASSET UR MARKNADSDATAN DET REDAN HÄMTAT (2026-10-23).
 *
 * `runCardTraderReverseImport` hämtar varje sets blueprints + HELA marknadsplatsen
 * (alla skick, alla språk) och använde förut bara NM-annonserna. Här räknas lägsta
 * engelska annons per skick för det ordinarie kortet och reverse-produkten ur SAMMA
 * svar — inga extra CardTrader-anrop, och skrivningen är EN sats per set i ett fönster
 * där Neon redan är vaken (nattkedjans tredje led). Domen bor i lib/condition-prices.ts.
 *
 * ⛔ Ett fel här får aldrig fälla reverse-passet: priserna per skick är en bisak, och
 *    kolumnen kan saknas om migrationen inte körts ⇒ varning, aldrig kast.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { CT_REVERSE_LABEL, ctNumberKey, type CtBlueprint, type CtMarketplace } from "@/lib/cardtrader";
import { conditionFloors } from "@/lib/condition-prices";

interface SetProduct {
  id: string;
  variantLabel: string | null;
  card: { number: string | null } | null;
}

export async function writeConditionPrices(
  prisma: PrismaClient,
  args: {
    bpByNum: Map<string, CtBlueprint>;
    products: SetProduct[];
    market: CtMarketplace;
    eurToOre: number;
    apply: boolean;
  }
): Promise<number> {
  const rows: { id: string; json: string }[] = [];
  for (const p of args.products) {
    if (p.variantLabel !== null && p.variantLabel !== CT_REVERSE_LABEL) continue;
    const key = ctNumberKey(p.card?.number);
    const bp = key ? args.bpByNum.get(key) : undefined;
    if (!bp) continue;
    const floors = conditionFloors(
      args.market[String(bp.id)],
      { reverse: p.variantLabel === CT_REVERSE_LABEL, firstEdition: false },
      args.eurToOre
    );
    // Även ett TOMT objekt skrivs: annonserna kan ha tagit slut sedan förra natten,
    // och ett gammalt golv får inte stå kvar som om det gällde.
    rows.push({ id: p.id, json: JSON.stringify(floors) });
  }
  if (!args.apply || rows.length === 0) return rows.length;
  try {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await prisma.$executeRaw`
        UPDATE "Product" AS p
        SET "conditionPrices" = v.cp::jsonb, "conditionPricesAt" = NOW()
        FROM (VALUES ${Prisma.join(chunk.map((r) => Prisma.sql`(${r.id}, ${r.json})`))}) AS v(id, cp)
        WHERE p.id = v.id`;
    }
  } catch (err) {
    console.warn(`[ct-condition] skrivningen misslyckades (${(err as Error).message.slice(0, 160)}) — reverse-passet fortsätter.`);
    return 0;
  }
  return rows.length;
}
