/**
 * ÅNGRAR en admin-nekad butiks-URL (tabellen `DeniedListingUrl`).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/undeny-listing-url.ts --list
 *   node scripts/with-prod-db.mjs npx tsx scripts/undeny-listing-url.ts <url> --apply
 *
 * VARFÖR DEN BEHÖVS: "Ta bort" på produktsidan nekar numera URL:en permanent, vilket
 * är rätt när listningen inte hör hemma i katalogen alls. Men samma knapp används
 * ibland på en länk som bara sitter på FEL produkt — och då är rätt åtgärd att flytta
 * länken, inte att spärra den. Mätt 2026-08-13: Aquitaz och Rogerz sålde
 * "Scarlet & Violet: Base Set Booster Pack" men länkarna satt på Base Set Booster
 * (WOTC 1999); hade de nekats istället för flyttats hade den rätta produkten förlorat
 * två av sina fjorton butiker.
 *
 * ⛔ Rör ALDRIG den statiska listan i src/scrapers/import-denylist.ts — den är
 *    kodgranskad historik och ändras via en commit, inte härifrån.
 */
import "./load-env";
import { prisma } from "../src/lib/db";
import { normalizeListingUrl } from "../src/scrapers/import-denylist";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LIST = args.includes("--list");
const RAW = args.find((a) => !a.startsWith("--"));

async function main() {
  if (LIST || !RAW) {
    const rows = await prisma.deniedListingUrl.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    console.log(`${rows.length} admin-nekade URL:er (nyast först):\n`);
    for (const r of rows) {
      console.log(`  ${r.createdAt.toISOString().slice(0, 16)}  ${r.retailer ?? "—"}`);
      console.log(`     ${r.url}`);
      if (r.reason) console.log(`     ${r.reason}`);
    }
    if (!RAW) console.log(`\nAnge en URL för att ångra den: … undeny-listing-url.ts <url> --apply`);
    return;
  }

  const url = normalizeListingUrl(RAW);
  const row = await prisma.deniedListingUrl.findUnique({ where: { url } });
  if (!row) {
    console.log(`Ingen admin-nekad post för:\n  ${url}`);
    console.log(`(Är den nekad ändå? Då står den i den STATISKA listan — ta bort den med en commit.)`);
    return;
  }
  console.log(`Nekad ${row.createdAt.toISOString().slice(0, 16)} · ${row.retailer ?? "—"}\n  ${row.url}\n  ${row.reason ?? ""}`);
  if (!APPLY) {
    console.log(`\nTORRKÖRNING — --apply för att ångra.`);
    return;
  }
  await prisma.deniedListingUrl.delete({ where: { url } });
  console.log(`\n✅ Ångrad. Nästa skrapning får skapa/länka URL:en igen.`);
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
