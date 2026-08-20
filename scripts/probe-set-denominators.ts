import { prisma } from "../src/lib/db";
import { loadSetDenominatorsRaw as loadSetDenominators } from "../src/services/set-portfolio";
import { resolveSetTotals } from "../src/lib/set-denominator";
async function main() {
  const rows = await loadSetDenominators();
  console.log(`${rows.length} set.`);
  const pick = ["Pitch Black", "Pokémon GO", "Base", "Ascended Heroes", "Black Bolt (SV11B)", "Surging Sparks"];
  for (const name of pick) {
    const r = rows.find((x) => x.name === name);
    if (!r) { console.log(`  ${name}: (hittades inte)`); continue; }
    const t = resolveSetTotals(r);
    console.log(`  ${name}: kort=${r.cardCount} printed=${r.totalCards} full=${t.full} listade tryckningar=${r.listedPrintings} facit=${r.printingsTotal} → master=${t.printings} not=${t.printingsElsewhere} short=${t.catalogShort}`);
  }
  const noFull = rows.filter((r) => resolveSetTotals(r).full == null).length;
  const withMaster = rows.filter((r) => { const t = resolveSetTotals(r); return t.printings != null && t.full != null && t.printings > t.full; }).length;
  const withNote = rows.filter((r) => resolveSetTotals(r).printingsElsewhere != null).length;
  console.log(`\nutan nämnare (ingen stapel): ${noFull}\nmed master set-rad: ${withMaster}\nmed "fler tryckningar"-not: ${withNote}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
