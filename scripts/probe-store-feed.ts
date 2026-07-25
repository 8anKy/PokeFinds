/**
 * Svarar en butiks-feed ibland med NOLL produkter UTAN att kasta fel?
 *
 * Det tysta svaret bakom Neon-kostnaden 2026-07-25: Alphaspel svarade tomt varannan
 * körning, vilket raderade butikens minne ur restock-grindens state-karta → nästa
 * lyckade hämtning såg hela sortimentet som "ny-i-lager" och väckte Neon i onödan.
 * Grinden tål det nu (`mergeStateMap`), men en butik som ofta svarar tomt är ändå ett
 * adapter-fel värt att åtgärda — och en tom feed märks aldrig i ett felmeddelande.
 *
 * Kör: PROBE_SOURCE=Alphaspel npx tsx -r dotenv/config scripts/probe-store-feed.ts
 */
import { getAdapter } from "../src/scrapers/runner";

const NAME = process.env.PROBE_SOURCE ?? "Alphaspel";
const TYPE = process.env.PROBE_TYPE ?? "SCRAPER";
const ROUNDS = Number(process.env.PROBE_ROUNDS ?? 6);

async function main() {
  for (let i = 1; i <= ROUNDS; i++) {
    const t0 = Date.now();
    try {
      const adapter = getAdapter(TYPE as never, NAME);
      const res = await adapter.fetchProducts();
      const valid = res.products.filter((p) => adapter.validateResult(p));
      const inStock = valid.filter((p) => adapter.normalizeProduct(p).stockStatus === "IN_STOCK");
      console.log(
        `#${i}  ${((Date.now() - t0) / 1000).toFixed(1)}s  råa=${res.products.length}  giltiga=${valid.length}  i-lager=${inStock.length}` +
          (valid.length === 0 ? "   <-- TOM MEN UTAN KASTAT FEL (adapter-fel, inte butiksfel)" : ""),
      );
    } catch (e) {
      console.log(`#${i}  KASTADE FEL: ${e instanceof Error ? e.message : e}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
