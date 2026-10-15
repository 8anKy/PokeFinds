/**
 * Revision: varje vara en adapter kallar PREORDER (eller OUT med förbokningsmarkör) —
 * går den FAKTISKT att boka? Hämtar butikernas feedar live (rör aldrig DB:n) och listar
 * PREORDER-raderna med URL, så varje produktsida kan kontrolleras mot sin köpknapp.
 *
 * Bakgrund 2026-10-13: Card Haven märkte Delta Reign "Inkommande" (inaktiv knapp) men
 * bar "Släpps 6 nov." ⇒ vi sa PREORDER och Discord postade "går nu att förhandsboka".
 *
 *   npx tsx scripts/audit-preorder-claims.ts [--store=<namn>]
 */
import { StockStatus } from "@prisma/client";
import type { SourceAdapter } from "../src/scrapers/types";
import { CardHavenAdapter } from "../src/scrapers/adapters/cardhaven-adapter";
import { SfBokAdapter } from "../src/scrapers/adapters/sfbok-adapter";
import { SweetNerdsAdapter } from "../src/scrapers/adapters/nyehandel-adapter";
import { MaxGamingAdapter } from "../src/scrapers/adapters/maxgaming-adapter";
import { WorldOfBoardGamesAdapter } from "../src/scrapers/adapters/worldofboardgames-adapter";
import { SpelOchSantAdapter } from "../src/scrapers/adapters/spelochsant-adapter";
import { AlphaspelAdapter } from "../src/scrapers/adapters/alphaspel-adapter";
import { WebhallenAdapter } from "../src/scrapers/adapters/webhallen-adapter";

const only = process.argv.find((a) => a.startsWith("--store="))?.slice(8).toLowerCase();

const adapters: SourceAdapter[] = [
  new CardHavenAdapter(),
  new SfBokAdapter(),
  new SweetNerdsAdapter(),
  new MaxGamingAdapter(),
  new WorldOfBoardGamesAdapter(),
  new SpelOchSantAdapter(),
  new AlphaspelAdapter(),
  new WebhallenAdapter(),
];

async function main() {
  for (const a of adapters) {
    if (only && !a.name.toLowerCase().includes(only)) continue;
    try {
      const res = await a.fetchProducts();
      const pre = res.products.filter((p) => p.stockStatus === StockStatus.PREORDER);
      console.log(`\n== ${a.name}: ${res.products.length} annonser, ${pre.length} PREORDER, ${res.errors.length} fel`);
      for (const e of res.errors.slice(0, 3)) console.log(`   fel: ${e}`);
      for (const p of pre) console.log(`   ${p.title.slice(0, 70)}\n     ${p.url}`);
    } catch (err) {
      console.log(`\n== ${a.name}: KRASCH ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  process.exit(0);
}

main();
