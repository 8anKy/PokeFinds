/**
 * Raderar spärrhake-FRUSEN singel-prishistorik (observationer + snapshots).
 *
 * BAKGRUND: singel-dagvakten saknade heal-referens (fix 9470d2c) → ett ≥3x-hopp
 * klämdes ALLTID till gårdagens värde. Frusna kort skrev därför SAMMA öre-belopp
 * som ny observation + snapshot varje dygn — historiken för de dagarna ÄR
 * korruptionen. När fixen sedan körde (2026-07-23 18:05-körningen) HEALADES
 * priserna: samma dag fick TVÅ Cardmarket-observationer, den frusna (klämd,
 * 15:38) och den healade (18:30). Rayquaza ★ Deoxys: 281 265 kr → 69 613 kr,
 * och grafen visade dagsmedlet 175 439 kr — en siffra som aldrig funnits.
 *
 * SIGNATUREN (varför detta är säkrare än avstånd-till-facit): dagvakten släpper
 * bara igenom ett ≥3x-hopp som ligger KLART NÄRMARE CM:s egen trend än gårdagens
 * värde (saneDayMove). Två samma-dags-obs ≥3x isär = ett dokumenterat heal-event,
 * inte en marknadsrörelse. Det frusna värdet A är dessutom en EXAKT öre-kopia
 * dag för dag (klämman returnerar priorOre oförändrat) → platån är entydig.
 *
 * VAD RADERAS: den bakåtlöpande svansen av Cardmarket-observationer som är
 * EXAKT lika med A — utom svansens FÖRSTA dag (ursprungsvärdet var källdata,
 * inte en klämkopia) — plus PriceSnapshot-rader med avgPrice == A i samma
 * datumfönster. Heal-dagens snapshot rättas till B (det healade värdet).
 *
 * Kör:  node scripts/with-prod-db.mjs npx tsx scripts/purge-frozen-singles.ts
 *       node scripts/with-prod-db.mjs npx tsx scripts/purge-frozen-singles.ts --apply
 *       node scripts/with-prod-db.mjs npx tsx scripts/purge-frozen-singles.ts --day 2026-07-23
 */
import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { DAY_MOVE_MAX } from "../src/jobs/cardmarket-refresh";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const argOf = (f: string) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const DAY = argOf("--day") ?? "2026-07-23"; // heal-dagen (18:05-körningen med fixen)
const LOOKBACK_DAYS = 120; // så långt bak en platå letas (frysen började ~2026-07-03)
// VÄRDEGOLV: under 10 kr rörs inget. 4 017 av 4 942 heal-kandidater är öres-kort
// (0,23 kr → 0,70 kr är också "≥3x") — där kan en exakt platå lika gärna vara ÄKTA
// stiltje (pinnat EUR_SEK gör flat EUR till flat öre), skadan av att behålla den är
// noll, och att radera data vi inte kan bevisa är fel bryter mot purge-principen.
const MIN_ORE = Number(argOf("--min-ore") ?? 1000);

async function main() {
  console.log(APPLY ? "APPLY — raderar.\n" : "DRY-RUN — inget raderas. Kör med --apply.\n");
  const dayStart = new Date(`${DAY}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const lookback = new Date(dayStart.getTime() - LOOKBACK_DAYS * 86_400_000);

  const cmSource = await prisma.scrapeSource.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cmSource) throw new Error("Cardmarket-källan saknas.");

  // Heal-kandidater: SINGLE_CARD med ≥2 CM-obs på heal-dagen där sista/första ≥3x isär.
  const dayRows = await prisma.$queryRawUnsafe<
    { productId: string; first: number; last: number; n: bigint }[]
  >(
    `SELECT po."productId",
            (array_agg(po.price ORDER BY po."observedAt" ASC))[1]  AS first,
            (array_agg(po.price ORDER BY po."observedAt" DESC))[1] AS last,
            count(*) AS n
     FROM "PriceObservation" po
     JOIN "Product" p ON p.id = po."productId" AND p.category = 'SINGLE_CARD'
     WHERE po."sourceId" = $1 AND po."observedAt" >= $2 AND po."observedAt" < $3
     GROUP BY po."productId"
     HAVING count(*) >= 2`,
    cmSource.id, dayStart, dayEnd
  );
  let belowFloor = 0;
  const healed = dayRows.filter((r) => {
    const a = Number(r.first), b = Number(r.last);
    if (!(a > 0 && b > 0 && (b / a >= DAY_MOVE_MAX || a / b >= DAY_MOVE_MAX))) return false;
    if (Math.max(a, b) < MIN_ORE) { belowFloor++; return false; } // öres-kort: rör ej
    return true;
  });
  console.log(
    `${dayRows.length} singlar med ≥2 CM-obs ${DAY}, varav ${healed.length} med ≥${DAY_MOVE_MAX}x-heal ` +
    `(fruset A → healat B). ${belowFloor} öres-kort under golvet ${MIN_ORE / 100} kr lämnas orörda.`
  );

  const obsToDelete: string[] = [];
  const snapVictims: { productId: string; frozen: number; healedVal: number; fromDate: Date }[] = [];
  const report: { title: string; aKr: number; bKr: number; days: number; obs: number }[] = [];
  let totalObs = 0;

  for (let i = 0; i < healed.length; i += 400) {
    const batch = healed.slice(i, i + 400);
    const ids = batch.map((r) => r.productId);
    const [obs, titles] = await Promise.all([
      prisma.priceObservation.findMany({
        where: { productId: { in: ids }, sourceId: cmSource.id, observedAt: { gte: lookback, lt: dayEnd } },
        orderBy: { observedAt: "desc" },
        select: { id: true, productId: true, price: true, observedAt: true },
      }),
      prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } }),
    ]);
    const titleOf = new Map(titles.map((t) => [t.id, t.title]));
    const byProduct = new Map<string, { id: string; price: number; observedAt: Date }[]>();
    for (const o of obs) (byProduct.get(o.productId) ?? byProduct.set(o.productId, []).get(o.productId)!).push(o);

    for (const r of batch) {
      const frozen = Number(r.first), healedVal = Number(r.last);
      const rows = byProduct.get(r.productId) ?? []; // redan desc på observedAt
      // Gå bakåt från heal-dagen: samla den sammanhängande svansen av obs == A.
      // Sista obs (B, healad) hoppas över; första icke-A-värdet avslutar svansen.
      const streak: { id: string; observedAt: Date }[] = [];
      for (const o of rows) {
        if (o.price === healedVal && o.observedAt >= dayStart) continue; // healade B-obs
        if (o.price === frozen) { streak.push(o); continue; }
        break;
      }
      if (streak.length === 0) continue;
      // Svansens ÄLDSTA obs är ursprungsvärdet (källdata, ingen klämkopia) — behåll den.
      const keepOldest = streak.pop()!;
      totalObs += streak.length;
      obsToDelete.push(...streak.map((s) => s.id));
      if (streak.length > 0) {
        snapVictims.push({
          productId: r.productId, frozen, healedVal,
          // snapshots raderas från dagen EFTER den bevarade ursprungsdagen
          fromDate: new Date(keepOldest.observedAt.toISOString().slice(0, 10) + "T00:00:00Z"),
        });
      }
      report.push({
        title: titleOf.get(r.productId) ?? r.productId,
        aKr: Math.round(frozen / 100), bKr: Math.round(healedVal / 100),
        days: streak.length ? Math.ceil((dayEnd.getTime() - streak[streak.length - 1].observedAt.getTime()) / 86_400_000) : 0,
        obs: streak.length,
      });
    }
  }

  report.sort((a, b) => b.obs - a.obs);
  console.log(`\n${report.filter((r) => r.obs > 0).length} singlar med klämkopie-platå. ${totalObs} observationer raderas:\n`);
  console.log("   obs  dagar    fruset A     healat B   produkt");
  for (const r of report.filter((x) => x.obs > 0).slice(0, 30))
    console.log(`  ${String(r.obs).padStart(4)} ${String(r.days).padStart(5)} ${String(r.aKr).padStart(10)} kr ${String(r.bKr).padStart(10)} kr  ${r.title.slice(0, 45)}`);
  if (report.length > 30) console.log(`  … och ${report.filter((x) => x.obs > 0).length - 30} till (se plan-filen).`);

  if (!APPLY) {
    const planPath = (process.env.TEMP ?? "/tmp") + "/purge-frozen-singles-plan.json";
    writeFileSync(planPath, JSON.stringify({ day: DAY, victims: report, totals: { products: report.filter((r) => r.obs > 0).length, observations: totalObs } }, null, 2));
    console.log(`\nDry-run. Full plan → ${planPath}. Kör med --apply.`);
    return;
  }

  // 1) Radera klämkopie-observationerna (grafens datapunkter).
  let obsDeleted = 0;
  for (let i = 0; i < obsToDelete.length; i += 500) {
    const { count } = await prisma.priceObservation.deleteMany({ where: { id: { in: obsToDelete.slice(i, i + 500) } } });
    obsDeleted += count;
  }
  // 2) Radera platå-snapshots (avgPrice == A, i platåfönstret) + rätta heal-dagens
  //    snapshot till B (createMany(skipDuplicates) i 18:05-körningen kunde inte
  //    ersätta 15:38-körningens frusna rad — den sitter kvar på A).
  let snapDeleted = 0, snapFixed = 0;
  for (const v of snapVictims) {
    const del = await prisma.priceSnapshot.deleteMany({
      where: { productId: v.productId, avgPrice: v.frozen, date: { gt: v.fromDate, lt: dayStart } },
    });
    snapDeleted += del.count;
    const fix = await prisma.priceSnapshot.updateMany({
      where: { productId: v.productId, date: dayStart, avgPrice: v.frozen },
      data: { minPrice: v.healedVal, maxPrice: v.healedVal, avgPrice: v.healedVal, volume: 1 },
    });
    snapFixed += fix.count;
  }
  console.log(`\nRaderade ${obsDeleted} frusna observationer + ${snapDeleted} platå-snapshots; rättade ${snapFixed} heal-dags-snapshots till B.`);
  console.log("Grafen byggs vidare framåt från nästa cardmarket-refresh (13:00 UTC).");
}

main().finally(() => prisma.$disconnect());
