/**
 * Set-täckningsrevision: har vi ALLA kort i varje set?
 *
 * EN Neon-läsning (aggregat, inga kort-rader) + EN pokemontcg.io-svep över
 * /sets (facit för engelska set). Japanska set har inget facit uppströms —
 * de kommer ur Cardmarkets expansioner och rapporteras separat, aldrig som
 * "saknade" mot ett facit som inte finns.
 *
 * Läser bara. Skriver ingenting.
 */
import { prisma } from "../src/lib/db";
import { fetchTcgSets } from "../src/scrapers/adapters/pokemontcg-adapter";

async function main() {
  const [sets, upstream] = await Promise.all([
    prisma.cardSet.findMany({
      select: {
        id: true,
        name: true,
        series: true,
        externalId: true,
        cmExpansionId: true,
        language: true,
        totalCards: true,
        releaseDate: true,
        _count: { select: { cards: true } },
      },
      orderBy: [{ language: "asc" }, { releaseDate: "desc" }],
    }),
    fetchTcgSets(),
  ]);

  const up = new Map(upstream.map((s) => [s.id, s]));
  const rows = sets.map((s) => {
    const u = s.externalId ? up.get(s.externalId) : undefined;
    return {
      id: s.id,
      name: s.name,
      series: s.series,
      lang: s.language,
      externalId: s.externalId,
      cmExpansionId: s.cmExpansionId,
      releaseDate: s.releaseDate ? s.releaseDate.toISOString().slice(0, 10) : null,
      dbCards: s._count.cards,
      dbTotalCards: s.totalCards,
      upstreamTotal: u ? u.total : null,
      upstreamPrinted: u ? u.printedTotal : null,
    };
  });

  const en = rows.filter((r) => r.lang === "EN");
  const jp = rows.filter((r) => r.lang !== "EN");
  const matched = en.filter((r) => r.upstreamTotal != null);
  const unmatched = en.filter((r) => r.upstreamTotal == null);
  const short = matched.filter((r) => r.dbCards < (r.upstreamTotal as number));
  const over = matched.filter((r) => r.dbCards > (r.upstreamTotal as number));
  const denomWrong = matched.filter((r) => r.dbTotalCards !== r.upstreamTotal);
  // Set utan facit: nämnaren mot vår egen kortmängd.
  const jpShort = jp.filter((r) => r.dbTotalCards > 0 && r.dbCards < r.dbTotalCards);
  const upstreamMissing = upstream.filter(
    (s) => !sets.some((x) => x.externalId === s.id)
  );

  const summary = {
    dbSets: sets.length,
    dbSetsEn: en.length,
    dbSetsJp: jp.length,
    dbCardsTotal: rows.reduce((a, r) => a + r.dbCards, 0),
    upstreamSets: upstream.length,
    upstreamCardsTotal: upstream.reduce((a, s) => a + s.total, 0),
    enSetsWithFacit: matched.length,
    enSetsWithoutFacit: unmatched.length,
    setsShortOfFacit: short.length,
    cardsMissingVsFacit: short.reduce(
      (a, r) => a + ((r.upstreamTotal as number) - r.dbCards),
      0
    ),
    setsOverFacit: over.length,
    setsWithWrongDenominator: denomWrong.length,
    upstreamSetsMissingEntirely: upstreamMissing.length,
    jpSetsShortOfOwnDenominator: jpShort.length,
  };

  console.log("=== SAMMANFATTNING ===");
  console.log(JSON.stringify(summary, null, 2));

  const fmt = (r: (typeof rows)[number]) =>
    `${r.lang} ${r.name} [${r.externalId ?? "cm:" + r.cmExpansionId}] db=${r.dbCards} totalCards=${r.dbTotalCards} facit=${r.upstreamTotal ?? "-"} (printed=${r.upstreamPrinted ?? "-"}) ${r.releaseDate ?? ""}`;

  console.log("\n=== SET SOM SAKNAR KORT MOT FACIT (" + short.length + ") ===");
  for (const r of short.sort(
    (a, b) => (b.upstreamTotal as number) - b.dbCards - ((a.upstreamTotal as number) - a.dbCards)
  ))
    console.log(`  -${(r.upstreamTotal as number) - r.dbCards}  ` + fmt(r));

  console.log("\n=== SET MED FLER KORT ÄN FACIT (" + over.length + ") ===");
  for (const r of over) console.log(`  +${r.dbCards - (r.upstreamTotal as number)}  ` + fmt(r));

  console.log("\n=== NÄMNARE (totalCards) ≠ FACIT (" + denomWrong.length + ") ===");
  for (const r of denomWrong) console.log("  " + fmt(r));

  console.log("\n=== SET HOS POKEMONTCG.IO SOM SAKNAS HELT (" + upstreamMissing.length + ") ===");
  for (const s of upstreamMissing)
    console.log(`  ${s.id} ${s.name} (${s.series}) total=${s.total} ${s.releaseDate ?? ""}`);

  console.log("\n=== EN-SET UTAN FACIT-KOPPLING (" + unmatched.length + ") ===");
  for (const r of unmatched) console.log("  " + fmt(r));

  console.log("\n=== JP-SET UNDER EGEN NÄMNARE (" + jpShort.length + ") ===");
  for (const r of jpShort) console.log("  " + fmt(r));

  console.log("\n=== JP-SET, ALLA (" + jp.length + ") ===");
  for (const r of jp) console.log("  " + fmt(r));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
