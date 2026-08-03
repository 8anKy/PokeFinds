/**
 * BILDREVISION — skannar HELA katalogens kortbilder och listar de trasiga.
 *
 * ⛔ "LADDAR" ÄR INTE "DUGER", och det går inte att se i SQL. En bild kan svara
 * 200 och ändå vara 200 px bred. MÄTT 2026-08-04: katalogen hade **301 kort under
 * 560 px** (ex1 103, ex2 97, ex4 97 — pokemontcg.io:s "_hires" är bara 400x550 för
 * de seten) och **3 döda** (xyp XY39/XY46/XY68). Inget av det syntes i någon
 * tidigare kontroll, eftersom alla mätte liv och inte kvalitet.
 *
 * Skriver `.spike/small-images.json`, som `fix-card-images.ts` läser via
 * `IDS_FILE=` — listan ERSÄTTER då dess SQL-heuristik, för den vet saker SQL inte
 * kan se.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-card-images.ts
 *   IDS_FILE=.spike/small-images.json APPLY=1 … scripts/fix-card-images.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { mapPool } from "../src/lib/concurrency";
import { writeFileSync } from "node:fs";
const prisma = new PrismaClient();
const MIN_W = 560;
async function main() {
  const all = await prisma.card.findMany({
    select: { id: true, name: true, number: true, imageUrl: true, tcgExternalId: true, set: { select: { externalId: true } } },
  });
  console.log(`skannar ${all.length} kortbilder …`);
  const small: { id: string; label: string; w: number; tcgid: string | null }[] = [];
  const dead: string[] = [];
  let done = 0;
  await mapPool(all, 16, async (c) => {
    try {
      const r = await fetch(c.imageUrl!, { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) { dead.push(`${c.set.externalId} #${c.number} ${c.name} HTTP ${r.status}`); return; }
      const m = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
      if ((m.width ?? 0) < MIN_W)
        small.push({ id: c.id, label: `${c.set.externalId} #${c.number} ${c.name}`, w: m.width!, tcgid: c.tcgExternalId });
    } catch (e) { dead.push(`${c.set.externalId} #${c.number} ${c.name} ${(e as Error).message.slice(0,20)}`); }
    if (++done % 4000 === 0) console.log(`  … ${done}/${all.length}`);
  });
  console.log(`\nDÖDA: ${dead.length}`); for (const d of dead.slice(0,10)) console.log("   " + d);
  console.log(`FÖR SMÅ (<${MIN_W} px): ${small.length}`);
  const bySet = new Map<string, number>();
  for (const s of small) { const k = s.label.split(" ")[0]; bySet.set(k, (bySet.get(k) ?? 0) + 1); }
  for (const [k, v] of [...bySet].sort((a,b)=>b[1]-a[1]).slice(0,15)) console.log(`   ${String(v).padStart(4)}  ${k}`);
  writeFileSync(".spike/small-images.json", JSON.stringify(small, null, 1));
  console.log(`\nlista sparad: .spike/small-images.json`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
