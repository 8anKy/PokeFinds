/**
 * RÄTTAR SAMLINGSPOSTER SOM SÄGER "ENGELSKA" OM ETT ICKE-ENGELSKT KORT.
 *
 * ⛔ `CollectionItem.language` defaultar till EN i schemat, och ingen av vägarna
 * in (produktsidan, snabbtillägget, skannern) skickade något språk — så varje
 * japansk singel låg inne som ENGELSK. Symptomet ägaren såg 2026-09-07: en
 * Tradera-annons för ett japanskt kort med raden "Språk: Engelska".
 *
 * Katalogen har en EGEN kortrad per språk, alltså är kortets språk ett faktum
 * medan postens default var en gissning. Roten är lagad i
 * `addCollectionItem` (nya poster ärver kortets språk); det här skriptet lagar
 * raderna som redan finns.
 *
 * ⛔ Rör BARA poster där posten säger EN och kortet säger något annat. En post
 * som säger JP/DE/FR är ett aktivt val och lämnas ifred — och EN-mot-EN är
 * redan rätt.
 *
 * Rapport:  node scripts/with-prod-db.mjs npx tsx scripts/fix-collection-item-language.ts
 * Verkställ: … scripts/fix-collection-item-language.ts --apply
 */
import "dotenv/config";
import type { CardLanguage } from "@prisma/client";
import { prisma } from "@/lib/db";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(APPLY ? "VERKSTÄLLER" : "TORRKÖRNING (--apply för att skriva)");

  const rows = await prisma.collectionItem.findMany({
    where: { language: "EN", card: { language: { not: "EN" } } },
    select: {
      id: true,
      language: true,
      card: { select: { name: true, number: true, language: true } },
    },
  });

  const byLang = new Map<CardLanguage, number>();
  for (const r of rows) {
    const lang = r.card!.language;
    byLang.set(lang, (byLang.get(lang) ?? 0) + 1);
  }
  for (const [lang, n] of byLang) console.log(`  ${lang}: ${n} poster`);
  for (const r of rows.slice(0, 5)) {
    console.log(`   ${r.card!.name} #${r.card!.number}: EN → ${r.card!.language}`);
  }

  if (APPLY) {
    // En uppdatering per språk i stället för en per rad — samma vakna fönster.
    for (const lang of byLang.keys()) {
      const ids = rows.filter((r) => r.card!.language === lang).map((r) => r.id);
      const res = await prisma.collectionItem.updateMany({
        where: { id: { in: ids } },
        data: { language: lang },
      });
      console.log(`  skrev ${res.count} poster → ${lang}`);
    }
  }

  console.log(`\nTotalt: ${rows.length}${APPLY ? " rättade" : " att rätta"}`);
  await prisma.$disconnect();
}

void main();
