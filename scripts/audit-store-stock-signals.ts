/**
 * REVISION AV LAGERSIGNALEN I VARJE BUTIKS FEED.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-store-stock-signals.ts
 *
 * FRÅGAN: kan butikens feed över huvud taget UTTRYCKA "slut i lager"? En feed som bara
 * listar det som finns inne — eller en adapter som inte hittar butikens lagermarkör —
 * ger offers som står permanent på IN_STOCK. Följden är TYST och tvåsidig:
 *   · inga falska restock-larm (inget går ju OUT→IN), men
 *   · inga ÄKTA heller — butiken kan bara någonsin ge "ny produkt i lager".
 * Butiken ser frisk ut i alla hälsomått medan den är blind för halva sitt syfte.
 *
 * Hämtar feedarna via runRestockScan fas 1 (ren HTTP, `shouldProcess` returnerar alltid
 * false) så DB:n bara läses för källistan. Jämför sedan feedens fördelning mot vad vi
 * HAR lagrat, vilket skiljer tre olika fel åt:
 *   FEED SAKNAR OOS   → adaptern/feeden kan inte uttrycka slutsåld (strukturellt hål)
 *   DB SAKNAR OOS     → feeden kan, men vi har aldrig sett det (nyligen tillagd butik?)
 *   FEED ≠ DB         → vår lagrade status släpar efter feeden
 *
 * ⛔ RAPPORT ONLY. Efter Webhallen-misstaget 2026-08-14 (jag byggde en lagervakt på ett
 * fältnamn som lät självklart och stängde av äkta larm) gäller regeln: MÄT FÖRST, och
 * bevisa att ett fält motsvarar KÖPBARHET innan något grindas på det.
 */
import "./load-env";
import { prisma } from "../src/lib/db";
import { runRestockScan, type RestockSourceInfo } from "../src/scrapers/runner";

async function main() {
  const active = await prisma.scrapeSource.findMany({ where: { isActive: true } });
  const sources: RestockSourceInfo[] = active
    .filter((s) => (s.config as { restockWatch?: boolean } | null)?.restockWatch === true)
    .map((s) => ({
      name: s.name,
      type: s.type,
      baseUrl: s.baseUrl,
      rotatingFeed: (s.config as { rotatingFeed?: boolean } | null)?.rotatingFeed === true,
    }));
  console.log(`[audit] ${sources.length} restock-bevakade butiker — hämtar feedarna...\n`);

  // Vad vi HAR lagrat, per butik.
  const retailers = await prisma.retailer.findMany({
    where: { name: { in: sources.map((s) => s.name) } },
    select: { id: true, name: true },
  });
  const dbCounts = new Map<string, Record<string, number>>();
  const grouped = await prisma.offer.groupBy({
    by: ["retailerId", "stockStatus"],
    where: { retailerId: { in: retailers.map((r) => r.id) } },
    _count: { _all: true },
  });
  const nameById = new Map(retailers.map((r) => [r.id, r.name]));
  for (const g of grouped) {
    const n = nameById.get(g.retailerId) ?? g.retailerId;
    const m = dbCounts.get(n) ?? {};
    m[g.stockStatus] = g._count._all;
    dbCounts.set(n, m);
  }

  type Stat = { total: number; in: number; out: number; other: number };
  const feedStats = new Map<string, Stat>();

  await runRestockScan({
    sources,
    shouldProcess: async (fetched) => {
      for (const f of fetched) {
        const s: Stat = { total: f.items.length, in: 0, out: 0, other: 0 };
        for (const it of f.items) {
          if (it.stockStatus === "IN_STOCK") s.in++;
          else if (it.stockStatus === "OUT_OF_STOCK") s.out++;
          else s.other++;
        }
        feedStats.set(f.sourceName, s);
      }
      return false; // rör aldrig DB-fasen
    },
  });

  const rows = sources.map((src) => {
    const f = feedStats.get(src.name) ?? { total: 0, in: 0, out: 0, other: 0 };
    const db = dbCounts.get(src.name) ?? {};
    return {
      name: src.name,
      feed: f,
      dbIn: db.IN_STOCK ?? 0,
      dbOut: db.OUT_OF_STOCK ?? 0,
      dbTotal: Object.values(db).reduce((a, b) => a + b, 0),
    };
  });

  console.log("=== FEEDENS LAGERFÖRDELNING vs VÅR DATABAS ===");
  console.log("  feed:  totalt / i lager / slut / övrigt        db: totalt / i lager / slut   butik");
  for (const r of rows.sort((a, b) => b.feed.total - a.feed.total)) {
    console.log(
      `  ${String(r.feed.total).padStart(5)} ${String(r.feed.in).padStart(8)} ${String(r.feed.out).padStart(6)} ` +
        `${String(r.feed.other).padStart(7)}   ${String(r.dbTotal).padStart(11)} ${String(r.dbIn).padStart(8)} ` +
        `${String(r.dbOut).padStart(6)}   ${r.name}`
    );
  }

  const blind = rows.filter((r) => r.feed.total >= 5 && r.feed.out === 0);
  console.log(
    `\n⛔ FEEDEN KAN INTE UTTRYCKA "SLUT" (${blind.length} butiker) — dessa kan ALDRIG ge ett restock-larm:`
  );
  for (const r of blind)
    console.log(
      `   ${r.name}: ${r.feed.total} annonser, ${r.feed.in} i lager, 0 slut ` +
        `(db: ${r.dbIn} i lager / ${r.dbOut} slut)`
    );

  const empty = rows.filter((r) => r.feed.total === 0);
  if (empty.length)
    console.log(`\n⛔ TOM FEED (hämtningen gav noll annonser): ${empty.map((r) => r.name).join(", ")}`);

  const unknown = rows.filter((r) => r.feed.other > 0);
  if (unknown.length) {
    console.log(`\n⚠️ ANNONSER MED OKÄND/ANNAN STATUS (varken i lager eller slut):`);
    for (const r of unknown) console.log(`   ${r.name}: ${r.feed.other} av ${r.feed.total}`);
  }
}

main().finally(() => prisma.$disconnect());
