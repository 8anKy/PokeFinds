/**
 * REVISION AV RESTOCK-SANNINGEN — hittar par som larmar om och om igen.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-restock-truth.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-restock-truth.ts --dagar=30
 *
 * VARFÖR: 2026-08-14 skickade Mega Greninja ex Premium Collection fem falska
 * RESTOCK-mejl på fyra dygn. Produkten var UTGÅNGEN hos Webhallen; den sista enheten
 * låg i en fysisk butik och lagerräknaren togglade 0↔1 när den reserverades och
 * släpptes. Ingen enskild flipp såg konstig ut — det var MÖNSTRET som avslöjade den:
 * samma (produkt, butik) om och om igen, med timmar emellan så blink-dämpningen
 * aldrig slog till.
 *
 * Det mönstret är generellt och butiksoberoende: en vara som verkligen fylls på tar
 * slut och kommer tillbaka några gånger i månaden, inte fjorton gånger på fyra dygn.
 * Skriptet rangordnar därför par på FLIPPAR PER DYGN och visar hur många larm de
 * kostat, så en trasig lagerkälla syns innan den hunnit tröttköra medlemmarna.
 *
 * ⛔ RAPPORT ONLY — skriver aldrig. Ett högt tal är en MISSTANKE, inte en dom:
 * Dragon's Lair togglar heta varor på riktigt (46 av 171 restocks under 14 dygn) och
 * ska ligga högt. Domen kräver att man tittar på butikens egen produktsida, precis
 * som Greninja-utredningen gjorde.
 */
import "./load-env";
import { prisma } from "../src/lib/db";

const days = Number(process.argv.find((a) => a.startsWith("--dagar="))?.split("=")[1] ?? 14);
const since = new Date(Date.now() - days * 86400_000);

async function main() {
  console.log(`[audit] Fönster: ${days} dygn (från ${since.toISOString()})\n`);

  const events = await prisma.restockEvent.findMany({
    where: { detectedAt: { gte: since } },
    select: {
      detectedAt: true,
      oldStatus: true,
      newStatus: true,
      retailer: { select: { name: true } },
      product: { select: { id: true, title: true, slug: true } },
    },
    orderBy: { detectedAt: "desc" },
  });

  type Row = { store: string; title: string; slug: string; flips: number; restocks: number };
  const byPair = new Map<string, Row>();
  for (const e of events) {
    const store = e.retailer?.name ?? "?";
    const key = `${store}\t${e.product?.id ?? "?"}`;
    const row =
      byPair.get(key) ??
      { store, title: e.product?.title ?? "?", slug: e.product?.slug ?? "?", flips: 0, restocks: 0 };
    row.flips++;
    if (e.oldStatus === "OUT_OF_STOCK" && e.newStatus === "IN_STOCK") row.restocks++;
    byPair.set(key, row);
  }

  const ranked = [...byPair.values()].sort((a, b) => b.flips - a.flips);
  console.log("=== MEST FLIPPANDE PAR (produkt × butik) ===");
  console.log("flippar  restocks  /dygn  butik / produkt");
  for (const r of ranked.slice(0, 25)) {
    console.log(
      `${String(r.flips).padStart(7)}  ${String(r.restocks).padStart(8)}  ` +
        `${(r.flips / days).toFixed(1).padStart(5)}  ${r.store} / ${r.title}`
    );
  }

  // Per butik: hur mycket av all churn står butiken för?
  const byStore = new Map<string, { flips: number; restocks: number; pairs: Set<string> }>();
  for (const [key, r] of byPair) {
    const s = byStore.get(r.store) ?? { flips: 0, restocks: 0, pairs: new Set<string>() };
    s.flips += r.flips;
    s.restocks += r.restocks;
    s.pairs.add(key);
    byStore.set(r.store, s);
  }
  console.log("\n=== PER BUTIK ===");
  console.log("flippar  restocks  par  flippar/par  butik");
  for (const [store, s] of [...byStore.entries()].sort((a, b) => b[1].flips - a[1].flips)) {
    console.log(
      `${String(s.flips).padStart(7)}  ${String(s.restocks).padStart(8)}  ${String(s.pairs.size).padStart(3)}  ` +
        `${(s.flips / s.pairs.size).toFixed(1).padStart(11)}  ${store}`
    );
  }

  // Täckning: butiker som sveps men inte kan posta något (inga rutter alls).
  const active = await prisma.scrapeSource.findMany({ where: { isActive: true } });
  const watched = active.filter(
    (s) => (s.config as { restockWatch?: boolean } | null)?.restockWatch === true
  );
  const retailers = await prisma.retailer.findMany({
    where: { name: { in: watched.map((s) => s.name) } },
    select: { id: true, name: true },
  });
  const grouped = await prisma.offer.groupBy({
    by: ["retailerId", "stockStatus"],
    where: { retailerId: { in: retailers.map((r) => r.id) } },
    _count: { _all: true },
  });
  const perRetailer = new Map<string, Record<string, number>>();
  for (const g of grouped) {
    const m = perRetailer.get(g.retailerId) ?? {};
    m[g.stockStatus] = g._count._all;
    perRetailer.set(g.retailerId, m);
  }

  console.log(`\n=== RESTOCK-BEVAKADE BUTIKER (${watched.length}) — offers per status ===`);
  console.log("totalt  i lager  slut  okänd  förhands  butik");
  const nameById = new Map(retailers.map((r) => [r.id, r.name]));
  const rows = [...perRetailer.entries()].map(([id, m]) => ({
    name: nameById.get(id) ?? id,
    total: Object.values(m).reduce((a, b) => a + b, 0),
    inStock: m.IN_STOCK ?? 0,
    out: m.OUT_OF_STOCK ?? 0,
    unknown: m.UNKNOWN ?? 0,
    pre: m.PREORDER ?? 0,
  }));
  for (const r of rows.sort((a, b) => b.total - a.total)) {
    console.log(
      `${String(r.total).padStart(6)}  ${String(r.inStock).padStart(7)}  ${String(r.out).padStart(4)}  ` +
        `${String(r.unknown).padStart(5)}  ${String(r.pre).padStart(8)}  ${r.name}`
    );
  }

  // ⚠️ EN BUTIK VARS FEED ALDRIG SÄGER "SLUT" KAN INTE RESTOCKA. Feeden listar då bara
  // det som finns inne (eller så läser adaptern ingen lagermarkör), så varje offer står
  // permanent på IN_STOCK. Följden är TYST: inga falska restock-larm — men inga ÄKTA
  // heller, för OUT→IN inträffar aldrig. Butiken syns bara via "ny produkt i lager".
  const neverOut = rows.filter((r) => r.total >= 5 && r.out === 0);
  if (neverOut.length) {
    console.log("\n⚠️ BUTIKER UTAN EN ENDA SLUTSÅLD OFFER (kan aldrig ge ett restock-larm):");
    for (const r of neverOut)
      console.log(`   ${r.name}: ${r.total} offers, ${r.inStock} i lager, ${r.unknown} okända`);
  }

  // Vilken artighetsnivå hamnar butiken på i Discord-lanen? Klassningen kommer från
  // adapterregistret, så en ny butik hamnar rätt automatiskt — men den är värd att kunna
  // LÄSA, inte bara lita på.
  const { getAdapter } = await import("../src/scrapers/runner");
  const { ShopifyAdapter } = await import("../src/scrapers/adapters/shopify-adapter");
  const fast: string[] = [];
  const slow: string[] = [];
  for (const s of watched) {
    let isFast = s.name === "Webhallen";
    if (!isFast) {
      try {
        isFast = getAdapter(s.type, s.name) instanceof ShopifyAdapter;
      } catch {
        isFast = false;
      }
    }
    (isFast ? fast : slow).push(s.name);
  }
  console.log(`\n=== DISCORD-LANENS ARTIGHETSNIVÅER ===`);
  console.log(`Snabb nivå, sveps VARJE tick (${fast.length}): ${fast.sort().join(", ")}`);
  console.log(`Långsam nivå, varannan tick (${slow.length}): ${slow.sort().join(", ")}`);

  const missing = watched.filter((s) => !retailers.some((r) => r.name === s.name));
  if (missing.length) {
    console.log(
      `\n⚠️ BEVAKADE UTAN RETAILER-RAD (sveps men kan aldrig posta): ${missing
        .map((s) => s.name)
        .join(", ")}`
    );
  }
  const noOffers = rows.filter((r) => r.total === 0).map((r) => r.name);
  if (noOffers.length) console.log(`\n⚠️ BEVAKADE UTAN OFFERS: ${noOffers.join(", ")}`);
}

main().finally(() => prisma.$disconnect());
