/**
 * Lagar TOMMA produktbilder: en `imageUrl` som pekar på /api/cm-image/<id> där
 * Cardmarket INTE har någon render ger en blank ruta i katalogen.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/repair-broken-cm-images.ts
 *   ... --apply
 *
 * ⛔ ORSAKEN, OCH DEN ÄR MIN EGEN: `link-missing-cm-products.ts` satte imageUrl på
 *    proxyn så fort TCGGO hade en bild — utan att kolla att CM har en EGEN render.
 *    Varningen står ordagrant i src/lib/cm-image.ts ("Använd cmRenderExists() innan du
 *    pekar en produkts imageUrl på proxyn — annars blir bilden trasig i katalogen") och
 *    jag lade den kollen bara i bildbytar-skriptet, inte i länkaren. Utfall: tre Delta
 *    Reign-blistrar visades som tomma rutor.
 *
 * FALLBACK-ORDNING: CM:s render (bäst, samma bild för alla) → TCGGO:s render (som ÄR
 * CM:s bild, serverad av leverantören) → behåll det som fanns. Aldrig en tom ruta.
 */
import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";
import { cmRenderExists } from "../src/lib/cm-image";
import { mapPool } from "../src/lib/concurrency";
import { normalizeTitle } from "../src/lib/utils";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const CACHE = path.join(process.cwd(), ".cache", "rapidapi-sealed.json");

async function main() {
  const api = JSON.parse(fs.readFileSync(CACHE, "utf-8")) as {
    name: string; cardmarket_id: number | null; image?: string;
  }[];
  const imgByCmId = new Map<number, string>();
  const imgByName = new Map<string, string>();
  for (const a of api) {
    if (!a.image) continue;
    if (a.cardmarket_id != null) imgByCmId.set(a.cardmarket_id, a.image);
    imgByName.set(normalizeTitle(a.name), a.image);
  }

  const all = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] }, hiddenAt: null },
    select: { id: true, title: true, normalizedTitle: true, imageUrl: true },
  });
  // Bara de som PEKAR på proxyn kan vara tomma på det här sättet — plus de helt bildlösa.
  const suspects = all.filter(
    (p) => !p.imageUrl || /^\/api\/cm-image\/(\d+)/.test(p.imageUrl ?? "")
  );
  console.log(`Kandidater att verifiera: ${suspects.length} (av ${all.length} sealed)\n`);

  let ok = 0, fixed = 0, stillBlank = 0;
  await mapPool(suspects, 8, async (p) => {
    const m = p.imageUrl?.match(/^\/api\/cm-image\/(\d+)/);
    const cmid = m ? Number(m[1]) : null;
    if (cmid != null && (await cmRenderExists(cmid))) { ok++; return; }

    const fallback =
      (cmid != null ? imgByCmId.get(cmid) : undefined) ?? imgByName.get(p.normalizedTitle) ?? null;
    if (!fallback) {
      stillBlank++;
      console.log(`  ⛔ TOM, ingen reserv  ${p.title.slice(0, 54)}`);
      return;
    }
    fixed++;
    console.log(`${APPLY ? "  LAGAR " : "  skulle"} ${p.title.slice(0, 50).padEnd(50)} → TCGGO-render`);
    if (APPLY) await prisma.product.update({ where: { id: p.id }, data: { imageUrl: fallback } });
  });

  console.log(`\nCM-render finns: ${ok}   ${APPLY ? "lagade" : "skulle laga"}: ${fixed}   kvar tomma utan reserv: ${stillBlank}`);
  if (!APPLY) console.log("Torrkörning — inget skrevs.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
