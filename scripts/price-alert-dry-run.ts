/**
 * TORRKÖRNING AV PRISLARMEN — vad hade larmat JUST NU, och varför inte?
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/price-alert-dry-run.ts
 *
 * Läser bara (två frågor + bevakningarna). Går igenom VARJE aktiv prisbevakning (alla
 * användare, Pro-status markerad) och dömer den med samma regel som jobben
 * (`judgePriceAlert`): lägsta köpbara pris nu mot produktens cachade lägstapris som
 * "senast sett". Skriver ingenting — pausflaggan spelar ingen roll här.
 *
 * Mätningen ägaren bad om före påslaget 2026-09-06: "mät på mina egna bevakningar först".
 */
import { prisma } from "../src/lib/db";
import { isPro } from "../src/lib/plan";
import { judgePriceAlert, priceAlertPolicy } from "../src/lib/price-alert-rule";
import { lowestBuyableByProduct } from "../src/services/alerts";

const kr = (ore: number | null | undefined) => (ore == null ? "–" : `${(ore / 100).toFixed(2)} kr`);

async function main() {
  const policy = priceAlertPolicy();
  const watches = await prisma.watchlistItem.findMany({
    where: { priceAlert: true, isPaused: false },
    select: {
      id: true,
      userId: true,
      targetPrice: true,
      priceAlertFiredOre: true,
      priceAlertFiredAt: true,
      createdAt: true,
      user: { select: { email: true, planTier: true, role: true, bonusProUntil: true, stripeProUntil: true } },
      product: { select: { id: true, title: true, lowestPriceOre: true, hiddenAt: true } },
    },
    orderBy: [{ userId: "asc" }, { createdAt: "asc" }],
  });
  const lowest = await lowestBuyableByProduct([...new Set(watches.map((w) => w.product.id))]);

  console.log(`Policy: ≥${policy.minPercent} % och ≥${policy.minOre / 100} kr, tak ${policy.maxPercent} %, återspänn +${policy.rearmPercent} %`);
  console.log(`Aktiva prisbevakningar: ${watches.length}\n`);

  const totals: Record<string, number> = {};
  let fires = 0;
  for (const w of watches) {
    const pro = isPro(w.user);
    const now = lowest.get(w.product.id) ?? null;
    const verdict = judgePriceAlert(w, now?.price ?? null, w.product.lowestPriceOre, policy);
    const outcome = verdict.fire ? `LARM ${verdict.kind}` : verdict.reason;
    totals[outcome] = (totals[outcome] ?? 0) + 1;
    if (verdict.fire && pro && !w.product.hiddenAt) fires++;
    console.log(
      `${verdict.fire ? "🔔" : "  "} ${outcome.padEnd(20)} ${pro ? "PRO " : "free"} ${w.user.email.padEnd(32)} ` +
        `${w.targetPrice != null ? `mål ${kr(w.targetPrice)}` : "prisfall"}`.padEnd(22) +
        ` sett ${kr(w.product.lowestPriceOre)} → nu ${kr(now?.price)}${now ? ` (${now.retailer.name})` : ""}` +
        `${w.priceAlertFiredOre != null ? ` spärr ${kr(w.priceAlertFiredOre)}` : ""}` +
        `${w.product.hiddenAt ? " [GÖMD]" : ""}  ${w.product.title}`
    );
  }

  console.log("\nUtfall:");
  for (const [k, v] of Object.entries(totals).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
  console.log(`\nHade skapat ${fires} larm (Pro, ej gömda) om flaggan slogs på nu.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
