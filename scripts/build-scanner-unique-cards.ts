/**
 * VILKA CARDMARKET-ONLY-KORT SKANNERN FÅR KÄNNA IGEN (2026-10-23, ägaren: "skannern ska känna
 * alla kort, och man väljer i listan vilket man har").
 *
 * Cardmarket-only-korten (`tcgExternalId "cm:<idProduct>"`) hålls utanför skannerns index för att
 * de flesta är OMTRYCK — samma konst och nummer som originalet (WCD-lekarna, stämplade promos).
 * I indexet hade de stulit träffar från originalet; nu svarar skannern originalet och omtrycket
 * finns som val i listan (namnsyskonen). Men kort som INTE är omtryck — Ancient Mew, onumrerade
 * japanska promos — gick då inte att skanna alls.
 *
 * Ett kort tas med när BÅDA gäller:
 *   1. inget vanligt kort (utanför cm:) har samma namn i samma språk — annars är det ett omtryck
 *      och syns redan som syskon;
 *   2. konsten liknar inget kort i skannerns index (blandad likhet < `SAME_ART_MIN`, samma 0,9
 *      som skannerns tvillingregel) — ett namn kan vara annorlunda stavat ("Pikachu Lv.12") fast
 *      bilden är originalets, och då hade det stulit träffar ändå.
 * Andra cm:-kort räknas inte som krock: fem Ancient Mew delar konst, men de är varandras syskon.
 *
 * Skriver `Card.scannerInclude` (på för de godkända, av för cm:-kort som inte längre godkänns).
 * Veckosteg i import-new-sets.yml EFTER konstavtrycken och FÖRE engine-sync, så ett nytt unikt
 * kort är igenkänningsbart samma natt det importerades.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/build-scanner-unique-cards.ts          # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/build-scanner-unique-cards.ts --apply
 */
import { prisma } from "@/lib/db";
import { searchByFingerprint } from "@/services/scanner/art-index";
import { CM_ONLY_EXTERNAL_PREFIX } from "@/lib/scanner-exclusion";
import { exitJob } from "@/lib/job-exit";

const SAME_ART_MIN = 0.9;
/**
 * Namnet som jämförs. CT/CM och vår katalog stavar samma kort olika: "Pokemon Reversal" /
 * "Pokémon Reversal", "Piplup Lv.9" / "Piplup", "Jolteon ☆ Gold Star" / "Jolteon ☆",
 * "Eevee δ Delta Species" / "Eevee δ", "Dialga [G]" / "Dialga G", "Gardenias" / "Gardenia's".
 * Utan normaliseringen räknades 85 WCD-omtryck som unika (2026-10-23).
 */
const baseName = (n: string) =>
  n
    .replace(/ \(JP\)$/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\blv\.?\s*\d+\b/g, "")
    .replace(/gold star/g, "☆")
    .replace(/delta species/g, "δ")
    .replace(/[^a-z0-9☆δ◇]/g, "");
/** Turneringslekarnas kort är ALLTID omtryck (guldkant + baksida gör konsten "olik" under 0,9). */
const REPRINT_SET = /^World Championship Decks\b/;
const int8 = (b: Uint8Array) => Int8Array.from(b, (v) => (v << 24) >> 24);

async function main() {
  const regular = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.card.findMany({
      where: { OR: [{ tcgExternalId: null }, { NOT: { tcgExternalId: { startsWith: CM_ONLY_EXTERNAL_PREFIX } } }] },
      select: { id: true, name: true, language: true },
      orderBy: { id: "asc" },
      take: 5000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    for (const r of rows) regular.add(`${r.language}|${baseName(r.name)}`);
  }

  const cm = await prisma.card.findMany({
    where: { tcgExternalId: { startsWith: CM_ONLY_EXTERNAL_PREFIX } },
    select: { id: true, name: true, number: true, language: true, tcgExternalId: true, artFingerprint: true, structFingerprint: true, set: { select: { name: true } } },
  });
  const cmIds = new Set(cm.map((c) => c.id));

  const keep: string[] = [];
  let nameTwin = 0, noPrint = 0, artTwin = 0;
  const artTwinSamples: string[] = [];
  for (const c of cm) {
    if (REPRINT_SET.test(c.set.name) || regular.has(`${c.language}|${baseName(c.name)}`)) { nameTwin++; continue; }
    if (!c.artFingerprint) { noPrint++; continue; }
    const matches = await searchByFingerprint({ color: int8(c.artFingerprint), struct: c.structFingerprint ? int8(c.structFingerprint) : null }, 5);
    const clash = matches.find((m) => !cmIds.has(m.cardId) && m.score >= SAME_ART_MIN);
    if (clash) {
      artTwin++;
      if (artTwinSamples.length < 15) {
        const o = await prisma.card.findUnique({ where: { id: clash.cardId }, select: { name: true, number: true, set: { select: { name: true } } } });
        artTwinSamples.push(`${c.name} · ${c.set.name} ${c.number}  ≈  ${o?.name} · ${o?.set.name} ${o?.number} (${clash.score.toFixed(3)})`);
      }
      continue;
    }
    keep.push(c.tcgExternalId!);
  }
  keep.sort();
  console.log({ cmOnly: cm.length, nameTwin, noFingerprint: noPrint, artTwin, included: keep.length });
  console.log("Konst som liknar ett indexerat kort (hålls utanför):\n  " + artTwinSamples.join("\n  "));
  if (process.argv.includes("--apply")) {
    const on = await prisma.card.updateMany({ where: { tcgExternalId: { in: keep }, scannerInclude: false }, data: { scannerInclude: true } });
    const off = await prisma.card.updateMany({
      where: { tcgExternalId: { startsWith: CM_ONLY_EXTERNAL_PREFIX, notIn: keep }, scannerInclude: true },
      data: { scannerInclude: false },
    });
    console.log(`Card.scannerInclude: ${on.count} på, ${off.count} av (${keep.length} totalt).`);
  } else console.log("Torrkörning — lägg till --apply.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => exitJob());
