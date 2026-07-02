/**
 * Veckovis hälsokoll av restock-bevakade butiksadaptrar.
 *
 * En adapter kan DÖ TYST — returnera 0 produkter utan att kasta fel — när butiken
 * byter plattform/HTML (t.ex. Dragon's Lair Vendre→Shopify, låg nere 22 juni–2 juli
 * utan att något syntes). Då slutar restock-/ny-produkt-larmen komma från just den
 * butiken, tyst. Detta jobb hämtar varje watched-adapter och FLAGGAR (exit 1 +
 * ::error::) om någon returnerar 0 giltiga produkter.
 *
 * Larm = GitHub Actions mejlar repo-ägaren automatiskt när körningen blir röd; loggen
 * namnger den trasiga butiken. Det här jobbet LAGAR INTE adaptern — en människa måste
 * läsa butikens nya markup och uppdatera adaptern (ingen kod kan bakåtkonstruera en
 * godtycklig ny sidlayout). Det byter en tyst flerveckorsutfall mot en varning inom 7 dagar.
 *
 * Körs: npx tsx scripts/check-store-health.ts  (veckovis via .github/workflows/store-health.yml)
 */
import { prisma } from "../src/lib/db";
import { getAdapter } from "../src/scrapers/runner";

async function main() {
  const sources = await prisma.scrapeSource.findMany({ where: { isActive: true } });
  const watched = sources.filter(
    (s) => (s.config as { restockWatch?: boolean } | null)?.restockWatch === true
  );
  if (watched.length === 0) {
    console.log("Inga restock-watch-källor flaggade — inget att kolla.");
    return;
  }

  const dead: { name: string; count: number; err?: string }[] = [];
  for (const s of watched) {
    try {
      const adapter = getAdapter(s.type, s.name);
      const res = await adapter.fetchProducts();
      const valid = res.products.filter((p) => adapter.validateResult(p));
      console.log(
        `${valid.length === 0 ? "❌" : "✅"} ${s.name}: ${valid.length} produkter` +
          (res.errors.length ? ` (${res.errors.length} fel)` : "")
      );
      if (valid.length === 0) dead.push({ name: s.name, count: 0, err: res.errors[0] });
    } catch (e) {
      console.log(`❌ ${s.name}: adaptern kastade fel`);
      dead.push({ name: s.name, count: 0, err: e instanceof Error ? e.message : String(e) });
    }
  }

  if (dead.length > 0) {
    for (const d of dead) {
      // ::error:: syns tydligt i Actions-loggen och sammanfattningen.
      console.log(
        `::error::${d.name} returnerar 0 produkter — trolig trasig adapter (butiken kan ha bytt plattform). ${d.err ?? ""}`
      );
    }
    console.log(
      `\n⚠️ ${dead.length} av ${watched.length} butiker verkar trasiga: ${dead.map((d) => d.name).join(", ")}`
    );
    process.exitCode = 1; // → röd körning → GitHub mejlar repo-ägaren
  } else {
    console.log(`\n✅ Alla ${watched.length} watched-butiker returnerar produkter.`);
  }
}

main()
  .catch((e) => {
    console.error("Hälsokoll kraschade:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
