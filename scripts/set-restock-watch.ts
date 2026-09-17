/**
 * Slår AV/PÅ restock-bevakningen för en butik utan att retirera den.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/set-restock-watch.ts --off "Rogerz" "Pokexclusive" --apply
 *   node scripts/with-prod-db.mjs npx tsx scripts/set-restock-watch.ts --on  "Rogerz" --apply
 *
 * Vad flaggan styr (`ScrapeSource.config.restockWatch`):
 *   • Ruttabellen (`scripts/lib/restock-routes.ts`) listar bara restockWatch-källor ⇒
 *     Discord-lanen slutar polla butiken, och därmed kommer inga larm-hits (push/mejl/
 *     in-app) därifrån heller — hitsen är lanens enda väg in sedan 2026-09-06.
 *   • `runRestockScan` (restock-watch, pausad) läser samma flagga.
 * Vad den INTE rör: källan förblir `isActive` ⇒ nattkedjan uppdaterar pris + lagerstatus
 * som förut, produktsidorna visar butiken, prisstatistiken räknar den. Veckobrevets
 * "i lager igen" bygger på nattkedjans RestockEvent och påverkas inte.
 *
 * ⛔ Kör ruttexporten efteråt (`gh workflow run restock-routes-export.yml`) — annars
 *    gäller ändringen först efter nästa scrape-all (02:00 UTC). Vill man ta bort butiken
 *    helt är det `scripts/retire-store.ts`.
 */
import { prisma, ensureDbAwake } from "../src/lib/db";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ON = args.includes("--on");
const OFF = args.includes("--off");
const names = args.filter((a) => !a.startsWith("--"));

async function main() {
  if (ON === OFF || names.length === 0) {
    throw new Error('Ange --on ELLER --off och minst ett butiksnamn, t.ex. --off "Rogerz" --apply');
  }
  const value = ON;
  console.log(APPLY ? "🔧 APPLY — skriver till databasen." : "🔍 TORRKÖRNING — inget skrivs. Kör med --apply.");
  await ensureDbAwake();
  for (const name of names) {
    const source = await prisma.scrapeSource.findFirst({ where: { name }, select: { id: true, name: true, isActive: true, config: true } });
    if (!source) {
      console.log(`⚠️  Ingen ScrapeSource heter "${name}" — hoppar.`);
      continue;
    }
    const cfg = (source.config as Record<string, unknown> | null) ?? {};
    const before = cfg.restockWatch === true;
    console.log(`${source.name}: isActive=${source.isActive} restockWatch ${before} → ${value}`);
    if (APPLY && before !== value) {
      await prisma.scrapeSource.update({ where: { id: source.id }, data: { config: { ...cfg, restockWatch: value } } });
    }
  }
  const watched = (await prisma.scrapeSource.findMany({ where: { isActive: true }, select: { config: true } })).filter(
    (s) => (s.config as { restockWatch?: boolean } | null)?.restockWatch === true
  ).length;
  console.log(`Bevakade butiker nu: ${watched}${APPLY ? "" : " (före ändring)"}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
