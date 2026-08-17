/**
 * Veckovis hälsokoll av restock-bevakade butiksadaptrar.
 *
 * En adapter kan DÖ TYST — returnera 0 produkter utan att kasta fel — när butiken
 * byter plattform/HTML (t.ex. Dragon's Lair Vendre→Shopify, låg nere 22 juni–2 juli
 * utan att något syntes). Då slutar restock-/ny-produkt-larmen komma från just den
 * butiken, tyst. Detta jobb hämtar varje watched-adapter och FLAGGAR (exit 1 +
 * ::error::) om någon returnerar 0 giltiga produkter.
 *
 * Larm = GitHub Actions mejlar repo-ägaren automatiskt när körningen blir röd; loggen
 * namnger den trasiga butiken. Det här jobbet LAGAR INTE adaptern — en människa måste
 * läsa butikens nya markup och uppdatera adaptern (ingen kod kan bakåtkonstruera en
 * godtycklig ny sidlayout). Det byter en tyst flerveckorsutfall mot en varning inom 7 dagar.
 *
 * Körs: npx tsx scripts/check-store-health.ts  (veckovis via .github/workflows/store-health.yml)
 */
import { prisma } from "../src/lib/db";
import { getAdapter } from "../src/scrapers/runner";

/**
 * "0 produkter" har TVÅ helt olika orsaker och de kräver olika människa-åtgärd:
 * butiken svarade 200 med markup vi inte längre förstår (adaptern måste skrivas om),
 * eller butiken VÄGRADE svara (brandvägg/WAF/ratelimit — adaptern är oskyldig och en
 * omskrivning hjälper inte). Meddelandet sa förut alltid det första, vilket skickade
 * granskningen åt fel håll i en hel vecka för Leksaksaffären (HTTP 403 mot
 * Actions-egress; `parsePrestaShopListing` mot samma HTML ger 23 giltiga poster, och
 * butikens robots.txt tillåter oss).
 * ⛔ Båda fallen förblir RÖDA. En 403 som degraderas till `::warning::` når ingen —
 * GitHub mejlar bara på failure.
 */
const REFUSAL_CODES = new Set([401, 403, 407, 429, 451]);

function refusalStatus(err?: string): number | null {
  const m = err?.match(/\bHTTP (\d{3})\b/);
  const code = m ? Number(m[1]) : null;
  return code !== null && REFUSAL_CODES.has(code) ? code : null;
}

function describeDead(d: { name: string; err?: string }): string {
  const code = refusalStatus(d.err);
  if (code !== null) {
    return (
      `${d.name} AVVISAR oss (HTTP ${code}) — butikens brandvägg/ratelimit, inte en trasig ` +
      `adapter. Kontrollera robots.txt och vår anropstakt innan adaptern rörs. ${d.err ?? ""}`
    );
  }
  return `${d.name} returnerar 0 produkter — trolig trasig adapter (butiken kan ha bytt plattform). ${d.err ?? ""}`;
}

async function main() {
  const sources = await prisma.scrapeSource.findMany({ where: { isActive: true } });
  const watched = sources.filter(
    (s) => (s.config as { restockWatch?: boolean } | null)?.restockWatch === true
  );
  if (watched.length === 0) {
    console.log("Inga restock-watch-källor flaggade — inget att kolla.");
    return;
  }

  const dead: { name: string; count: number; err?: string }[] = [];
  for (const s of watched) {
    try {
      const adapter = getAdapter(s.type, s.name);
      const res = await adapter.fetchProducts();
      const valid = res.products.filter((p) => adapter.validateResult(p));
      console.log(
        `${valid.length === 0 ? "❌" : "✅"} ${s.name}: ${valid.length} produkter` +
          (res.errors.length ? ` (${res.errors.length} fel)` : "")
      );
      if (valid.length === 0) dead.push({ name: s.name, count: 0, err: res.errors[0] });
    } catch (e) {
      console.log(`❌ ${s.name}: adaptern kastade fel`);
      dead.push({ name: s.name, count: 0, err: e instanceof Error ? e.message : String(e) });
    }
  }

  if (dead.length > 0) {
    for (const d of dead) {
      // ::error:: syns tydligt i Actions-loggen och sammanfattningen.
      console.log(`::error::${describeDead(d)}`);
    }
    const refused = dead.filter((d) => refusalStatus(d.err) !== null);
    console.log(
      `\n⚠️ ${dead.length} av ${watched.length} butiker gav 0 produkter: ${dead.map((d) => d.name).join(", ")}`
    );
    if (refused.length > 0) {
      console.log(
        `   ${refused.length} av dem AVVISADE oss (${refused
          .map((d) => `${d.name} ${refusalStatus(d.err)}`)
          .join(", ")}) — det är åtkomst, inte markup. Lagas inte i adaptern.`
      );
    }
    process.exitCode = 1; // → röd körning → GitHub mejlar repo-ägaren
  } else {
    console.log(`\n✅ Alla ${watched.length} watched-butiker returnerar produkter.`);
  }
}

main()
  .catch((e) => {
    console.error("Hälsokoll kraschade:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
