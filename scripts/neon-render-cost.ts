/**
 * VAD KOSTAR EN PRODUKTSID-RENDER I DB-FRÅGOR — och fungerar cachen?
 *
 * Mäter pg_stat_statements-deltat runt N kontrollerade HTTP-anrop. Körs i två omgångar
 * mot SAMMA slugs: fungerar ISR/data-cachen ska andra omgången kosta ~0 frågor. Gör den
 * inte det renderas varje besök om från DB — och då är det cachen, inte frågorna, som
 * är felet.
 *
 * Kör: node scripts/with-prod-db.mjs npx tsx scripts/neon-render-cost.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
// ⛔ APEX, aldrig www: www 301:as av Cloudflare och en sond mot den mäter
// redirecten i stället för appen (noll DB-renders → "gratis" och helt fel).
const BASE = process.env.PROBE_BASE ?? "https://foilio.se";
const N = Number(process.env.PROBE_N ?? 8);

const total = async () => {
  const r = await db.$queryRawUnsafe<any[]>(`
    select coalesce(sum(calls),0)::float8 as calls, coalesce(sum(rows),0)::float8 as rows
    from pg_stat_statements
    where query like 'SELECT "public".%'`);
  return r[0];
};

async function hit(paths: string[], label: string) {
  const before = await total();
  const codes: string[] = [];
  for (const p of paths) {
    const res = await fetch(`${BASE}${p}`, { headers: { "user-agent": "FoilioCacheProbe/1.0" } });
    codes.push(`${res.status}${res.headers.get("x-nextjs-cache") ? `/${res.headers.get("x-nextjs-cache")}` : ""}`);
  }
  // Låt server-sidans skrivningar/queries hinna registreras i pg_stat_statements.
  await new Promise((r) => setTimeout(r, 4000));
  const after = await total();
  console.log(
    `${label}: ${paths.length} anrop → +${after.calls - before.calls} app-frågor ` +
      `(+${((after.calls - before.calls) / paths.length).toFixed(1)}/render), +${after.rows - before.rows} rader`,
  );
  console.log(`   svar: ${codes.join(" ")}`);
}

async function main() {
  const products = await db.product.findMany({
    select: { slug: true },
    orderBy: { viewCount: "asc" },
    take: 400,
  });
  // Slugs ingen tittat på → garanterat kalla, och de förorenar inte populär-statistiken.
  const picked = products.slice(0, N).map((p) => `/produkter/${p.slug}`);

  console.log(`Bas: ${BASE}\n`);
  await hit(picked, "OMGÅNG 1 (kalla slugs)   ");
  await hit(picked, "OMGÅNG 2 (SAMMA slugs)   ");
  await hit(picked, "OMGÅNG 3 (SAMMA slugs)   ");
  console.log(
    "\nTolkning: omgång 2–3 ska vara ~0 frågor om ISR/data-cachen håller. " +
      "Ligger de kvar på omgång 1-nivå renderas varje besök om mot Neon.",
  );
}

main()
  .catch((e) => {
    console.error(String(e).slice(0, 400));
    process.exit(1);
  })
  .finally(() => db.$disconnect());
