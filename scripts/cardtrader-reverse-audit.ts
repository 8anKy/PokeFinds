/**
 * REVISION: hur mycket reverse holo-pris finns det EGENTLIGEN hos CardTrader?
 *
 * Handoffen uppskattade "~29 % av katalogen har reverse holo ⇒ ~6 000 nya
 * produkter". Det är en uppskattning ur TCGdex taxonomi, inte ett mått på
 * MARKNADEN. Innan 6 000 katalogposter skapas måste tre saker vara mätta:
 *
 *  1. **Mappningen.** Går våra CardSet att koppla till CardTraders expansioner
 *     alls? Ingen mappning = inget pris, hur bra taxonomin än är.
 *  2. **Täckningen.** Hur många av korten i ett mappat set får faktiskt ett
 *     NM-engelskt reverse-golv? (Paldea Evolved: 176 blueprints — men hur
 *     många är VÅRA kort?)
 *  3. **Värdet.** Paldea Evolveds reverse-golv toppar på 0,56 € (~6 kr). Om
 *     hela katalogen ser ut så är 6 000 nya produkter mest en utspädning av
 *     sökresultaten. Äldre set kan se helt annorlunda ut — det är precis det
 *     som måste mätas innan bygget, inte efter.
 *
 * SKRIVER ALDRIG. Bara läsning + rapport.
 *
 *   npx tsx scripts/cardtrader-reverse-audit.ts                 # mappning (gratis, 1 API-anrop)
 *   SETS=12 npx tsx scripts/cardtrader-reverse-audit.ts --deep  # + marknadsdata för 12 set
 *   SETS=all npx tsx scripts/cardtrader-reverse-audit.ts --deep # hela katalogen (~2 anrop/set)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  cheapestReverseNmEn,
  ctBlueprints,
  ctExpansions,
  ctMarketplace,
  ctNumberKey,
  isSingleBlueprint,
  matchExpansion,
  type CtBlueprint,
  type CtExpansion,
} from "../src/lib/cardtrader";
import { getRatesOre } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();
const DEEP = process.argv.includes("--deep");
const SETS_ARG = process.env.SETS ?? "10";
const MIN_DEPTH = Number(process.env.MIN_DEPTH ?? "1");
const GAP_MS = Number(process.env.GAP_MS ?? "700");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { eurToOre } = await getRatesOre();

  const [sets, expansions] = await Promise.all([
    prisma.cardSet.findMany({
      select: {
        id: true,
        name: true,
        series: true,
        externalId: true,
        releaseDate: true,
        _count: { select: { cards: true } },
      },
      orderBy: { releaseDate: "desc" },
    }),
    ctExpansions(),
  ]);

  const withCards = sets.filter((s) => s._count.cards > 0);
  const mapped: Array<{ set: (typeof withCards)[number]; exp: CtExpansion }> = [];
  const unmapped: typeof withCards = [];
  for (const s of withCards) {
    const exp = matchExpansion(s.name, s.series, expansions);
    if (exp) mapped.push({ set: s, exp });
    else unmapped.push(s);
  }

  console.log("=".repeat(72));
  console.log("STEG 1 — MAPPNING (namnmatchning, exakt och entydig)");
  console.log("=".repeat(72));
  console.log(`Våra set med kort:        ${withCards.length}`);
  console.log(`CardTrader-expansioner:   ${expansions.length} (Pokémon)`);
  console.log(
    `MAPPADE:                  ${mapped.length} (${((mapped.length / withCards.length) * 100).toFixed(1)} %)`
  );
  console.log(`OMAPPADE:                 ${unmapped.length}`);
  const unmappedCards = unmapped.reduce((n, s) => n + s._count.cards, 0);
  const mappedCards = mapped.reduce((n, m) => n + m.set._count.cards, 0);
  console.log(`  kort i mappade set:     ${mappedCards}`);
  console.log(`  kort i omappade set:    ${unmappedCards}`);
  console.log("\nOmappade set (20 största):");
  for (const s of [...unmapped].sort((a, b) => b._count.cards - a._count.cards).slice(0, 20)) {
    console.log(`  ${String(s._count.cards).padStart(4)} kort  ${s.name}`);
  }

  if (!DEEP) {
    console.log("\n(kör med --deep för marknadsdata)");
    await prisma.$disconnect();
    return;
  }

  const targets =
    SETS_ARG === "all" ? mapped : mapped.slice(0, Math.max(1, Number(SETS_ARG) || 10));

  console.log("\n" + "=".repeat(72));
  console.log(`STEG 2 — MARKNADSDATA (${targets.length} set, ~2 API-anrop styck)`);
  console.log("=".repeat(72));
  console.log(
    `Kurs: 1 EUR = ${(eurToOre / 100).toFixed(2)} kr · MIN_DEPTH=${MIN_DEPTH}\n`
  );

  const allPrices: number[] = [];
  const allDepths: number[] = [];
  /** Golv över 1 000 kr — kandidater för "inte egentligen till salu"-annonser. */
  const suspicious: Array<{ set: string; card: string; ore: number; depth: number }> = [];
  let totalCards = 0;
  let totalPriced = 0;
  let totalNumberMiss = 0;
  const perSet: Array<{ name: string; cards: number; priced: number; medianOre: number; maxOre: number }> = [];

  for (const { set, exp } of targets) {
    let blueprints: CtBlueprint[];
    let market: Awaited<ReturnType<typeof ctMarketplace>>;
    try {
      blueprints = await ctBlueprints(exp.id);
      await sleep(GAP_MS);
      market = await ctMarketplace(exp.id);
      await sleep(GAP_MS);
    } catch (err) {
      console.log(`  ⚠ ${set.name}: ${(err as Error).message.slice(0, 90)}`);
      continue;
    }

    const cards = await prisma.card.findMany({
      where: { setId: set.id },
      select: { id: true, name: true, number: true, rarity: true },
    });
    totalCards += cards.length;

    // blueprint-index på normaliserat samlarnummer (entydigt: mätt 286/287)
    const bpByNum = new Map<string, CtBlueprint>();
    for (const b of blueprints) {
      if (!isSingleBlueprint(b)) continue;
      const k = ctNumberKey(b.fixed_properties.collector_number);
      if (!k) continue;
      // Vid krock (Orthworm Holo/Non-Holo) vinner den FÖRSTA — reverse-golvet är
      // ändå per annons, inte per CM-produkt. Rapporteras som krock nedan.
      if (!bpByNum.has(k)) bpByNum.set(k, b);
    }

    const prices: number[] = [];
    let priced = 0;
    let numberMiss = 0;
    for (const c of cards) {
      const k = ctNumberKey(c.number);
      const bp = k ? bpByNum.get(k) : null;
      if (!bp) {
        numberMiss++;
        continue;
      }
      const rev = cheapestReverseNmEn(market[String(bp.id)], MIN_DEPTH);
      if (!rev) continue;
      priced++;
      const ore = Math.round((rev.cents / 100) * eurToOre);
      prices.push(ore);
      allPrices.push(ore);
      allDepths.push(rev.depth);
      if (ore >= 100_000) {
        suspicious.push({ set: set.name, card: `${c.number} ${c.name}`, ore, depth: rev.depth });
      }
    }
    totalPriced += priced;
    totalNumberMiss += numberMiss;
    prices.sort((a, b) => a - b);
    const median = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
    const max = prices.length ? prices[prices.length - 1] : 0;
    perSet.push({ name: set.name, cards: cards.length, priced, medianOre: median, maxOre: max });
    console.log(
      `  ${set.name.padEnd(30).slice(0, 30)} ${String(priced).padStart(4)}/${String(cards.length).padEnd(4)} kort med reverse-pris` +
        ` · median ${(median / 100).toFixed(2)} kr · max ${(max / 100).toFixed(2)} kr` +
        (numberMiss ? ` · ${numberMiss} nummer utan blueprint` : "")
    );
  }

  allPrices.sort((a, b) => a - b);
  allDepths.sort((a, b) => a - b);
  const q = (arr: number[], p: number) => (arr.length ? arr[Math.floor(arr.length * p)] : 0);

  console.log("\n" + "=".repeat(72));
  console.log("SUMMERING");
  console.log("=".repeat(72));
  console.log(`Kort i granskade set:        ${totalCards}`);
  console.log(`  utan blueprint på numret:  ${totalNumberMiss}`);
  console.log(
    `  MED reverse-golv:          ${totalPriced} (${((totalPriced / Math.max(1, totalCards)) * 100).toFixed(1)} % av korten)`
  );
  console.log(`\nPris (SEK) på de ${allPrices.length} korten som får ett golv:`);
  console.log(`  min    ${(q(allPrices, 0) / 100).toFixed(2)} kr`);
  console.log(`  median ${(q(allPrices, 0.5) / 100).toFixed(2)} kr`);
  console.log(`  p90    ${(q(allPrices, 0.9) / 100).toFixed(2)} kr`);
  console.log(`  p99    ${(q(allPrices, 0.99) / 100).toFixed(2)} kr`);
  console.log(`  max    ${(allPrices[allPrices.length - 1] / 100).toFixed(2)} kr`);
  console.log(`\nAnnonsdjup (antal NM-en-reverse-annonser bakom golvet):`);
  console.log(`  min ${allDepths[0]} · median ${q(allDepths, 0.5)} · p90 ${q(allDepths, 0.9)}`);
  console.log(`  kort med BARA 1 annons: ${allDepths.filter((d) => d === 1).length}`);
  const over20 = allPrices.filter((p) => p >= 2000).length;
  console.log(`\nKort med golv ≥ 20 kr: ${over20} (${((over20 / Math.max(1, allPrices.length)) * 100).toFixed(1)} %)`);

  console.log(
    `\nMISSTÄNKTA GOLV (≥ 1 000 kr) — ${suspicious.length} st. Djupet avgör om minDepth räcker som skydd:`
  );
  for (const s of suspicious.sort((a, b) => b.ore - a.ore).slice(0, 20)) {
    console.log(
      `  ${(s.ore / 100).toFixed(2).padStart(14)} kr · djup ${String(s.depth).padStart(3)} · ${s.set} ${s.card}`
    );
  }
  console.log(
    `  varav djup 1: ${suspicious.filter((s) => s.depth === 1).length} / ${suspicious.length}`
  );

  console.log(`\nDe 15 set med DYRAST reverse-golv:`);
  for (const s of [...perSet].sort((a, b) => b.maxOre - a.maxOre).slice(0, 15)) {
    console.log(
      `  ${s.name.padEnd(32).slice(0, 32)} max ${(s.maxOre / 100).toFixed(2).padStart(9)} kr · median ${(s.medianOre / 100).toFixed(2).padStart(7)} kr · ${s.priced}/${s.cards}`
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
