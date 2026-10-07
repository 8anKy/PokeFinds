/**
 * Fyller `CardSet.slug` för set som saknar en (src/lib/set-slug.ts). Rör ALDRIG en
 * befintlig slug — en ändrad slug är en ny URL.
 *
 *   npx tsx scripts/backfill-set-slugs.ts            # torrkörning
 *   npx tsx scripts/backfill-set-slugs.ts --apply
 * Prod: node scripts/with-prod-db.mjs npx tsx scripts/backfill-set-slugs.ts --apply
 *
 * Nattligen som steg i cardmarket-refresh.yml och import-new-sets.yml (nya set får
 * sin adress samma natt; tills dess fungerar id-adressen).
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

import { prisma } from "../src/lib/db";
import { exitJob } from "../src/lib/job-exit";
import { assignSetSlugs } from "../src/lib/set-slug";

const apply = process.argv.includes("--apply");

async function main() {
  const [missing, existing] = await Promise.all([
    prisma.cardSet.findMany({
      where: { slug: null },
      select: { id: true, name: true, series: true, language: true, releaseDate: true },
    }),
    prisma.cardSet.findMany({ where: { slug: { not: null } }, select: { slug: true } }),
  ]);
  if (missing.length === 0) {
    console.log("[set-slugs] alla set har en adress");
    return;
  }
  const slugs = assignSetSlugs(missing, new Set(existing.map((s) => s.slug!)));
  for (const s of missing.slice(0, 10)) console.log(`  ${s.name} → ${slugs.get(s.id)}`);
  if (!apply) {
    console.log(`[set-slugs] TORRKÖRNING — ${missing.length} set skulle få en adress (--apply)`);
    return;
  }
  for (const s of missing) {
    await prisma.cardSet.update({ where: { id: s.id }, data: { slug: slugs.get(s.id)! } });
  }
  console.log(`[set-slugs] ${missing.length} set fick en läsbar adress`);
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(() => void exitJob(Number(process.exitCode ?? 0)));
