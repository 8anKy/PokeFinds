/**
 * Rapport (READ ONLY): vilka ScrapeSources är restock-bevakade (dvs syns i
 * Discord-lanens källista) och vilka är det inte. Kör i ett fönster där Neon
 * ändå är vaken.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-restock-watch-coverage.ts
 */
import { prisma } from "@/lib/db";
import { getAdapter } from "@/scrapers/runner";

async function main() {
  const all = await prisma.scrapeSource.findMany({ orderBy: { name: "asc" } });
  const rows = all.map((s) => {
    const cfg = (s.config as { restockWatch?: boolean } | null) ?? {};
    let adapter = true;
    try {
      getAdapter(s.type, s.name);
    } catch {
      adapter = false;
    }
    return { name: s.name, type: s.type, active: s.isActive, watch: cfg.restockWatch === true, adapter, baseUrl: s.baseUrl };
  });
  const on = rows.filter((r) => r.active && r.watch);
  const off = rows.filter((r) => !(r.active && r.watch));
  console.log(`TOTALT ${rows.length} källor — ${on.length} bevakade, ${off.length} inte.\n`);
  console.log("INTE BEVAKADE:");
  for (const r of off) {
    console.log(
      `  ${r.name.padEnd(24)} ${String(r.type).padEnd(10)} active=${r.active ? "ja " : "NEJ"} ` +
        `adapter=${r.adapter ? "ja " : "NEJ"} ${r.baseUrl}`
    );
  }
  console.log("\nBEVAKADE:");
  console.log(on.map((r) => `  ${r.name} (${r.type})`).join("\n"));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
