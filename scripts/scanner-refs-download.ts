/**
 * REFERENSBILDER LOKALT för offline-prototypen av skannern utan AI: ETT officiellt kortfoto
 * per kort (hela katalogen, ~26 000), nedskalat till 480 px höjd JPEG → `.spike/refs/<cardId>.jpg`.
 * Återupptagbar (hoppar över befintliga filer), 8 parallella hämtningar.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/scanner-refs-download.ts
 * ⛔ Bara lokalt/internt — `.spike/` är gitignorerad.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import { mapPool } from "../src/lib/concurrency";

const prisma = new PrismaClient();
const OUT = path.join(process.cwd(), ".spike", "refs");

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const cards = await prisma.card.findMany({
    where: { NOT: { imageUrl: null } },
    select: { id: true, imageUrl: true, name: true, number: true, language: true, setId: true },
  });
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(cards));
  const todo = cards.filter((c) => !fs.existsSync(path.join(OUT, `${c.id}.jpg`)));
  console.log(`${cards.length} kort med bild, ${todo.length} kvar att hämta`);
  let done = 0, failed = 0;
  await mapPool(todo, 8, async (c) => {
    try {
      const res = await fetch(c.imageUrl!, { headers: { "user-agent": "Foilio/1.0 (+https://foilio.se)" } });
      if (!res.ok) throw new Error(String(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      await sharp(buf).resize({ height: 480, withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toFile(path.join(OUT, `${c.id}.jpg`));
    } catch {
      failed++;
    }
    if (++done % 1000 === 0) console.log(`${done}/${todo.length} (fel ${failed})`);
  });
  console.log(`Klart: ${done} hämtade, ${failed} fel`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
