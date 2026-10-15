/**
 * Släppdatum för set skapade av import-cm-only-singles.ts (`externalId "ct:<id>"`).
 * De fick först Cardmarkets dateAdded (när CM lade in produkten — WCD 2010 stod som
 * "släppt 27 jan 2026"). Rätt datum = TCGdex (exakt namn), annars null ("–").
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-cm-only-set-dates.ts [--apply]
 */
import { prisma } from "@/lib/db";
import { tcgdexJson } from "@/lib/tcgdex";
import { exitJob } from "@/lib/job-exit";

const key = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");

async function main() {
  const apply = process.argv.includes("--apply");
  const brief = (await tcgdexJson<{ id: string; name: string }[]>("https://api.tcgdex.net/v2/en/sets")) ?? [];
  const byName = new Map(brief.map((s) => [key(s.name), s.id]));
  const sets = await prisma.cardSet.findMany({ where: { externalId: { startsWith: "ct:" } }, select: { id: true, name: true, releaseDate: true } });
  let dated = 0, cleared = 0;
  for (const s of sets) {
    const id = byName.get(key(s.name));
    const full = id ? await tcgdexJson<{ releaseDate?: string }>(`https://api.tcgdex.net/v2/en/sets/${id}`) : null;
    const date = full?.releaseDate ? new Date(full.releaseDate) : null;
    if (date) dated++; else cleared++;
    if (apply) await prisma.cardSet.update({ where: { id: s.id }, data: { releaseDate: date } });
  }
  console.log(`${sets.length} set: ${dated} fick TCGdex-datum, ${cleared} okänt (null).${apply ? "" : " Torrkörning."}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => exitJob());
