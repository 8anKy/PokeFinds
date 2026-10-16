/**
 * Vilka set får en ruta på /sets och vilka döljs (`lib/set-listing.ts`). Läser bara.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/set-listing-report.ts [rapportfil]
 *
 * Samma urval som sidan: engelska set + japanska set med kort, minst en synlig produkt.
 * Ändra ett enskilt set i `src/data/set-listing-overrides.json`.
 */
import * as fs from "fs";
import { prisma } from "../src/lib/db";
import { isSetListed } from "../src/lib/set-listing";

async function main() {
  const sets = await prisma.cardSet.findMany({
    where: { OR: [{ language: "EN" }, { language: "JP", cards: { some: {} } }], products: { some: { hiddenAt: null } } },
    select: { name: true, language: true, externalId: true, releaseDate: true, _count: { select: { cards: true } } },
    orderBy: { releaseDate: { sort: "desc", nulls: "last" } },
  });
  const out: string[] = [];
  for (const L of ["EN", "JP"]) {
    const mine = sets.filter((s) => s.language === L);
    const listed = mine.filter((s) => isSetListed(s));
    const hidden = mine.filter((s) => !isSetListed(s));
    out.push(`\n===== ${L}: ${listed.length} rutor, ${hidden.length} dolda (av ${mine.length}) =====`);
    out.push(`\n--- ${L} RUTOR ---`);
    for (const s of listed) out.push(`  ${s.releaseDate?.toISOString().slice(0, 10) ?? "    -     "}  ${String(s._count.cards).padStart(4)}  ${s.name}`);
    out.push(`\n--- ${L} DOLDA (korten finns kvar) ---`);
    for (const s of hidden) out.push(`  ${s.releaseDate?.toISOString().slice(0, 10) ?? "    -     "}  ${String(s._count.cards).padStart(4)}  ${s.name}`);
  }
  const text = out.join("\n");
  if (process.argv[2]) fs.writeFileSync(process.argv[2], text);
  console.log(process.argv[2] ? out.filter((l) => l.startsWith("\n=====")).join("") : text);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
