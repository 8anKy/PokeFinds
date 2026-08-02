/**
 * VILKEN GRIND SKA AVGÖRA ATT ETT KORT *HAR* REVERSE HOLO?
 *
 * Handoffen säger TCGdex `variants.reverse`. Det är en bra grind — men den kostar
 * ETT API-anrop PER KORT (mätt: `variants` finns bara i kort-svaret, inte i
 * set-svaret ⇒ ~20 500 anrop för katalogen).
 *
 * CardTrader bär SIN EGEN taxonomi gratis i blueprint-exporten vi ändå hämtar:
 * `pokemon_reverse` står bland `editable_properties` bara för kort där varianten
 * finns (1 anrop per SET). Om de två är ense är TCGdex-grinden 20 500 anrop för
 * information vi redan har.
 *
 * Det här skriptet MÄTER om de är ense, per kort, över några set. Ingen skrivning.
 *
 *   npx tsx scripts/cardtrader-reverse-taxonomy-check.ts
 *   SETS=sv02,sv03,sv01 npx tsx scripts/cardtrader-reverse-taxonomy-check.ts
 *
 * `SETS` är TCGdex set-id; CardTrader-expansionen slås upp på setets namn.
 */
import "dotenv/config";
import {
  blueprintAllowsReverse,
  cheapestReverseNmEn,
  ctBlueprints,
  ctExpansions,
  ctMarketplace,
  ctNumberKey,
  isSingleBlueprint,
  matchExpansion,
} from "../src/lib/cardtrader";
import { mapPool } from "../src/lib/concurrency";

const DEX_SETS = (process.env.SETS ?? "sv02,sv03,swsh12").split(",").map((s) => s.trim());

interface DexCard {
  id: string;
  localId: string;
  name: string;
  variants?: { reverse?: boolean; normal?: boolean; holo?: boolean };
}

async function main() {
  const expansions = await ctExpansions();

  let agree = 0;
  let dexOnly = 0; // TCGdex säger reverse, CardTrader-taxonomin gör inte
  let ctOnly = 0; // tvärtom
  let bothNo = 0;
  const dexOnlyPriced: string[] = [];
  const ctOnlyPriced: string[] = [];

  for (const dexSetId of DEX_SETS) {
    const dexSet = (await (await fetch(`https://api.tcgdex.net/v2/en/sets/${dexSetId}`)).json()) as {
      id: string;
      name: string;
      cards: DexCard[];
    };
    const exp = matchExpansion(dexSet.name, null, expansions);
    if (!exp) {
      console.log(`⚠ ${dexSet.name}: ingen CardTrader-expansion`);
      continue;
    }

    const [blueprints, market] = await Promise.all([ctBlueprints(exp.id), ctMarketplace(exp.id)]);
    const bpByNum = new Map<string, (typeof blueprints)[number]>();
    for (const b of blueprints) {
      if (!isSingleBlueprint(b)) continue;
      const k = ctNumberKey(b.fixed_properties.collector_number);
      if (k && !bpByNum.has(k)) bpByNum.set(k, b);
    }

    // TCGdex variants kräver ett anrop PER KORT (mapPool returnerar void → egen ackumulator).
    const dexCards: Array<DexCard | null> = new Array(dexSet.cards.length).fill(null);
    await mapPool(dexSet.cards, 8, async (c, i) => {
      try {
        dexCards[i] = (await (
          await fetch(`https://api.tcgdex.net/v2/en/cards/${c.id}`)
        ).json()) as DexCard;
      } catch {
        dexCards[i] = null;
      }
    });

    let sAgree = 0, sDexOnly = 0, sCtOnly = 0;
    for (const c of dexCards) {
      if (!c?.variants) continue;
      const bp = bpByNum.get(ctNumberKey(c.localId) ?? "");
      if (!bp) continue;
      const dexRev = c.variants.reverse === true;
      const ctRev = blueprintAllowsReverse(bp);
      const priced = cheapestReverseNmEn(market[String(bp.id)]) != null;

      if (dexRev && ctRev) { agree++; sAgree++; }
      else if (dexRev && !ctRev) {
        dexOnly++; sDexOnly++;
        if (priced) dexOnlyPriced.push(`${dexSet.name} ${c.localId} ${c.name}`);
      } else if (!dexRev && ctRev) {
        ctOnly++; sCtOnly++;
        if (priced) ctOnlyPriced.push(`${dexSet.name} ${c.localId} ${c.name}`);
      } else bothNo++;
    }
    console.log(
      `${dexSet.name.padEnd(24)} ense(ja) ${String(sAgree).padStart(4)} · bara TCGdex ${String(sDexOnly).padStart(3)} · bara CardTrader ${String(sCtOnly).padStart(3)}`
    );
  }

  const total = agree + dexOnly + ctOnly + bothNo;
  console.log("\n" + "=".repeat(64));
  console.log(`Jämförda kort: ${total}`);
  console.log(`  BÅDA säger reverse:        ${agree}`);
  console.log(`  BÅDA säger nej:            ${bothNo}`);
  console.log(`  bara TCGdex säger reverse: ${dexOnly}`);
  console.log(`  bara CardTrader:           ${ctOnly}`);
  console.log(
    `  ÖVERENSSTÄMMELSE:          ${(((agree + bothNo) / Math.max(1, total)) * 100).toFixed(2)} %`
  );
  console.log(
    `\nOenighet som FAKTISKT har ett publicerbart reverse-pris (= den enda oenighet som spelar roll):`
  );
  console.log(`  bara TCGdex, med pris:     ${dexOnlyPriced.length}`);
  for (const s of dexOnlyPriced.slice(0, 10)) console.log(`     ${s}`);
  console.log(`  bara CardTrader, med pris: ${ctOnlyPriced.length}`);
  for (const s of ctOnlyPriced.slice(0, 10)) console.log(`     ${s}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
