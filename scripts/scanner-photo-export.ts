/**
 * SKANNERFACIT-EXPORT — hämtar ägarens sparade skannerfoton + facit till disk,
 * så att en bildmatchare UTAN AI kan mätas offline mot riktiga fångster.
 *
 *   railway run npx tsx scripts/scanner-photo-export.ts            (S3_* + DATABASE_URL ur Railway)
 *   SINCE=2026-09-29 railway run npx tsx scripts/scanner-photo-export.ts
 *
 * Fotona sparas bara för ADMIN (se /api/scanner/identify, `scanner-facit/`).
 * Utdata: `.spike/facit/<job-id>.jpg` + `.spike/facit/labels.json`.
 *
 * FACIT per foto = det kort ägaren till slut lät stå:
 *   corrected  → valde ett ANNAT kort (starkt)
 *   confirmed  via "pick" → aktivt val (starkt nog)
 *   confirmed  via "bulk" → "Lägg till alla" (SVAGT — invände inte)
 *   rejected / searched / ingen dom → inget facit (raden skrivs ändå, truth: null)
 * ⛔ Blanda aldrig styrkorna i ett tal — `strength` följer med varje rad.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { getObjectBytes, listKeys, storageEnabled } from "../src/lib/object-storage";

const prisma = new PrismaClient();
const OUT = path.join(process.cwd(), ".spike", "facit");
const SINCE = process.env.SINCE ? new Date(process.env.SINCE) : new Date("2026-09-29");

interface UserChosen {
  cardId?: string | null;
  kind?: "corrected" | "confirmed" | "rejected" | "searched";
  via?: "pick" | "bulk" | "auto";
  productId?: string;
  rank?: number;
}

async function main() {
  if (!storageEnabled()) throw new Error("S3_* saknas — kör via `railway run`.");
  fs.mkdirSync(OUT, { recursive: true });

  const keys = await listKeys("scanner-facit/");
  const byJob = new Map(keys.map((k) => [path.basename(k, ".jpg"), k]));
  const jobs = await prisma.scannerJob.findMany({
    where: { id: { in: [...byJob.keys()] }, createdAt: { gte: SINCE } },
    select: { id: true, createdAt: true, result: true },
    orderBy: { createdAt: "asc" },
  });

  const truthIds = new Set<string>();
  for (const j of jobs) {
    const u = (j.result as { userChosen?: UserChosen } | null)?.userChosen;
    if (u?.cardId) truthIds.add(u.cardId);
    const shown = (j.result as { recall?: { shown?: string[] } } | null)?.recall?.shown?.[0];
    if (shown) truthIds.add(shown);
  }
  const cards = new Map(
    (
      await prisma.card.findMany({
        where: { id: { in: [...truthIds] } },
        select: { id: true, name: true, number: true, language: true, imageUrl: true, set: { select: { name: true } } },
      })
    ).map((c) => [c.id, c])
  );

  const labels = [];
  let downloaded = 0;
  for (const j of jobs) {
    const file = path.join(OUT, `${j.id}.jpg`);
    if (!fs.existsSync(file)) {
      const bytes = await getObjectBytes(byJob.get(j.id)!);
      if (!bytes) continue;
      fs.writeFileSync(file, bytes);
      downloaded++;
    }
    const r = j.result as { userChosen?: UserChosen; recall?: { shown?: string[]; src?: string } } | null;
    const u = r?.userChosen;
    const positive = u?.kind === "corrected" || u?.kind === "confirmed";
    const truth = positive && u?.cardId ? cards.get(u.cardId) ?? null : null;
    const shown = r?.recall?.shown?.[0] ? cards.get(r.recall.shown[0]) ?? null : null;
    labels.push({
      jobId: j.id,
      at: j.createdAt.toISOString(),
      file: `${j.id}.jpg`,
      kind: u?.kind ?? null,
      strength: !positive ? null : u?.kind === "corrected" || u?.via === "pick" ? "strong" : "weak",
      src: r?.recall?.src ?? "vision",
      truth: truth && {
        cardId: truth.id,
        name: truth.name,
        number: truth.number,
        set: truth.set.name,
        language: truth.language,
        imageUrl: truth.imageUrl,
      },
      shownTop: shown && { cardId: shown.id, name: shown.name, number: shown.number, set: shown.set.name },
    });
  }
  fs.writeFileSync(path.join(OUT, "labels.json"), JSON.stringify(labels, null, 2));

  const strong = labels.filter((l) => l.strength === "strong").length;
  const weak = labels.filter((l) => l.strength === "weak").length;
  console.log(
    `Foton ${labels.length} (nya ${downloaded}) · facit starkt ${strong} · svagt ${weak} · utan facit ${
      labels.length - strong - weak
    } → ${OUT}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
