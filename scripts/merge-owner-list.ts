/**
 * Kör ägarens GRANSKADE merge-lista (scripts/data/owner-merge-list-*.txt).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/merge-owner-list.ts <fil>
 *   ... --apply           # skriver
 *   ... --apply --force   # skriver ÄVEN par där en vakt säger nej
 *
 * ⛔ Listan är ÄGARENS dom, inte matcharens: den innehåller par vakterna med rätta
 *    avvisar automatiskt (t.ex. "B Grade – RIPPED SEAL" in i den hela produkten).
 *    Vakternas utfall SKRIVS UT per par och kräver `--force` — så att ett nej aldrig
 *    passerar obemärkt, men ägarens beslut ändå går att verkställa.
 * ⛔ RIKTNINGEN är ägarens: "från" raderas. `mergeWouldLoseTrackRecord` flaggas men
 *    stoppar bara utan --force.
 * ⛔ Mergen är OÅTERKALLELIG (PriceSnapshot kaskaderar). Torrkör alltid först.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { productsConflict } from "../src/scrapers/matching";
import { mergeStubInto, mergeWouldLoseTrackRecord } from "../src/jobs/dedupe-stubs";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
const file = process.argv.slice(2).find((a) => !a.startsWith("--"));

const SEL = {
  id: true, slug: true, title: true, category: true, language: true, gtin: true, setId: true,
  _count: { select: { offers: true, priceSnapshots: true, watchlistItems: true, collectionItems: true } },
} as const;

async function main() {
  if (!file) throw new Error("Ange listfilen.");
  const pairs = readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [from, to] = l.split("->").map((s) => s.trim());
      return { from, to };
    });

  let merged = 0, missing = 0, blocked = 0, alreadySame = 0;
  const blockedRows: string[] = [];

  for (const { from, to } of pairs) {
    const a = await prisma.product.findUnique({ where: { slug: from }, select: SEL });
    const b = await prisma.product.findUnique({ where: { slug: to }, select: SEL });
    const label = `${from}\n      → ${to}`;

    if (!a && !b) { console.log(`SAKNAS BÅDA  ${label}`); missing++; continue; }
    if (!a) { console.log(`REDAN KLAR   ${from}  (målet finns)`); missing++; continue; }
    if (!b) { console.log(`⛔ MÅL SAKNAS ${label}`); missing++; continue; }
    if (a.id === b.id) { console.log(`SAMMA        ${from}`); alreadySame++; continue; }

    const cmA = await prisma.offer.count({ where: { productId: a.id, retailer: { name: "Cardmarket" } } });
    const cmB = await prisma.offer.count({ where: { productId: b.id, retailer: { name: "Cardmarket" } } });
    const conflict = productsConflict(a.title, b.title, b.language);
    const loses = await mergeWouldLoseTrackRecord(a.id, b.id);
    const catDiff = a.category !== b.category;
    const objections = [conflict && "konflikt", loses && "meritlista", catDiff && `kategori ${a.category}→${b.category}`]
      .filter(Boolean).join(", ");

    const stats = `[${a._count.offers}o/${a._count.priceSnapshots}s/CM:${cmA ? "ja" : "nej"}] → [${b._count.offers}o/${b._count.priceSnapshots}s/CM:${cmB ? "ja" : "nej"}]`;

    if (objections && !FORCE) {
      console.log(`⚠ VAKT NEJ   ${label}\n      ${stats}  (${objections})`);
      blockedRows.push(`${from} → ${to}  (${objections})`);
      blocked++;
      continue;
    }
    if (!APPLY) {
      console.log(`${objections ? "FORCE " : "OK    "}       ${label}\n      ${stats}${objections ? `  ⚠ ${objections}` : ""}`);
      merged++;
      continue;
    }
    await mergeStubInto(a.id, b.id, () => {});
    console.log(`MERGAD${objections ? " (force)" : ""}       ${label}\n      ${stats}`);
    merged++;
  }

  console.log(
    `\n${APPLY ? "Mergade" : "Skulle merga"}: ${merged}   redan klara/saknas: ${missing}   samma: ${alreadySame}   stoppade av vakt: ${blocked}`
  );
  if (blockedRows.length) {
    console.log(`\nStoppade av vakt (kräver --force efter granskning):`);
    for (const r of blockedRows) console.log(`   ${r}`);
  }
  if (!APPLY) console.log(`\nTorrkörning — inget skrevs.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
