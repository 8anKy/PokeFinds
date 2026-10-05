/**
 * Exporterar det Discord-snabbfilen behöver för att vara HELT DB-FRI:
 *   1. KÄLLISTAN (restock-bevakade butiker: namn, typ, baseUrl, rotatingFeed)
 *   2. RUTTABELLEN (butiks-URL → vår produkt: titel, slug, set, serie)
 *
 * Körs SIST i scrape-all, där Neon ändå är vaken — därför kostar den noll extra
 * compute. ⛔ Lägg den ALDRIG i en egen cron: Neon debiteras per VAKEN TID och varje
 * väckning köper minst 300 s. Hela poängen med snabbfilen är att den aldrig väcker
 * databasen, och en exportör som gör det själv hade ätit upp besparingen.
 * (Sedan 2026-08-13 exporterar även restock-watch-lanen om tabellen när den skapat
 * nya offers — Neon är vaken i exakt de körningarna. Logiken bor i lib/restock-routes.)
 *
 * Utfallet skrivs som EN JSON-fil som GitHub Actions cachar; snabbfilen restaurerar
 * den med en egen nyckel. Blir filen gammal (butiker byter sortiment) märks det som
 * "okänd URL" i snabbfilens logg, aldrig som fel data — okända URL:er postas inte.
 *
 * + SETNAMNEN (set-names.json bredvid): butiksnyhetslanen (store-social) känner igen
 *   ett inlägg om "Delta Reign" på setnamnet, även för set som ännu inte har en enda
 *   butiksrutt. Nya + kommande set (senaste 18 mån, eller utan släppdatum).
 *
 * Kör: node scripts/with-prod-db.mjs npx tsx scripts/export-restock-routes.ts
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { exportRestockRoutes } from "./lib/restock-routes";

const OUT = process.env.RESTOCK_ROUTES_FILE ?? ".restock-routes/routes.json";
const SET_NAMES_MONTHS = 18;

async function exportSetNames(file: string) {
  const since = new Date(Date.now() - SET_NAMES_MONTHS * 30.5 * 864e5);
  const sets = await prisma.cardSet.findMany({
    where: { OR: [{ releaseDate: { gte: since } }, { releaseDate: null }] },
    select: { name: true },
  });
  const names = [...new Set(sets.map((s) => s.name.trim()).filter(Boolean))].sort();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(names));
  console.log(`Setnamn: ${names.length} → ${file}`);
}

exportRestockRoutes(OUT)
  .then(() => exportSetNames(path.join(path.dirname(OUT), "set-names.json")))
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
