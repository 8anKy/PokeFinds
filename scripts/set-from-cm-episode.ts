/**
 * Skapar (eller kompletterar) ett CardSet ur CARDMARKETS episodlista.
 *
 * VARFÖR: katalogens set kommer normalt från pokemontcg.io, men den källan får ett
 * set först när det är SLÄPPT. Cardmarket listar kommande expansioner månader i
 * förväg — och våra sealed-produkter finns redan då (butikerna säljer förhandsboxar,
 * auto-importen skapar produkterna) men med setId=null. Utan ett CardSet syns de
 * varken i set-filtret eller på /sets, och man kan inte bläddra fram det nya setet.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/set-from-cm-episode.ts --episode=431
 *   node scripts/with-prod-db.mjs npx tsx scripts/set-from-cm-episode.ts --episode=431 --apply
 *   node scripts/with-prod-db.mjs npx tsx scripts/set-from-cm-episode.ts --name="30th Celebration"
 *   node scripts/with-prod-db.mjs npx tsx scripts/set-from-cm-episode.ts --list   # nyaste episoderna
 *
 * TORRKÖRNING ÄR DEFAULT. På ett BEFINTLIGT set fylls bara TOMMA fält (logotyp,
 * releasedatum) — pokemontcg.io:s egen data skrivs aldrig över utan `--force`.
 *
 * externalId lämnas med flit NULL: när pokemontcg.io väl får setet adopterar
 * `import-tcg-data.ts` raden på namn och sätter identiteten då. Skulle vi gissa ett
 * externalId (”me6”) och gissa fel blir det två set med samma namn i filtret.
 *
 * Produkternas set-ETIKETT sätts inte här — den kommer från
 * `import-sealed-from-cardmarket.ts` (cmid → episodens namn → vårt set), som är den
 * enda vägen som binder produkt till set på exakt id i stället för på titeltext.
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

import { prisma } from "../src/lib/db";

const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const APPLY = flag("apply");
const FORCE = flag("force");

interface Episode {
  id: number;
  name: string;
  released_at: string | null;
  logo: string | null;
  code: string | null;
  cards_total: number | null;
  series: { name: string } | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

async function fetchEpisodes(): Promise<Episode[]> {
  if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas i .env");
  const out: Episode[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(`https://${HOST}/pokemon/episodes?page=${page}`, {
      headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY },
    });
    if (!res.ok) throw new Error(`Episodlistan svarade ${res.status}`);
    const j = (await res.json()) as { data?: Episode[]; paging?: { total?: number } };
    const rows = j.data ?? [];
    out.push(...rows);
    // `paging.total` = ANTAL SIDOR (samma fälla som i cardmarket-refresh: metadata
    // om antal kort ljuger, sidantalet gör det inte).
    if (rows.length === 0 || (j.paging?.total != null && page >= j.paging.total)) break;
  }
  return out;
}

async function main() {
  const episodes = await fetchEpisodes();
  const byDate = [...episodes].sort((a, b) =>
    (b.released_at ?? "").localeCompare(a.released_at ?? "")
  );

  if (flag("list")) {
    console.log("NYASTE EPISODERNA HOS CARDMARKET:");
    for (const e of byDate.slice(0, 20))
      console.log(
        `  --episode=${String(e.id).padEnd(4)} ${e.released_at ?? "utan datum"}  ${e.series?.name ?? "—"} · ${e.name}`
      );
    return;
  }

  const epId = arg("episode");
  const epName = arg("name");
  if (!epId && !epName) {
    console.error("Ange --episode=<id> eller --name=\"<episodnamn>\" (eller --list).");
    process.exit(1);
  }
  const ep = epId
    ? episodes.find((e) => e.id === Number(epId))
    : episodes.find((e) => norm(e.name) === norm(epName!));
  if (!ep) {
    console.error(`Hittade ingen episod för ${epId ? `id ${epId}` : `"${epName}"`}.`);
    process.exit(1);
  }

  const series = ep.series?.name ?? null;
  const released = ep.released_at ? new Date(`${ep.released_at}T00:00:00.000Z`) : null;
  console.log(
    `EPISOD ${ep.id}: "${ep.name}" · serie ${series ?? "SAKNAS"} · släpp ${ep.released_at ?? "okänt"} · logotyp ${ep.logo ? "ja" : "NEJ"}`
  );
  if (!series) {
    console.error("Episoden saknar serie hos Cardmarket → skulle skapa ett set utan hemvist. Avbryter.");
    process.exit(1);
  }

  // Matcha på normaliserat namn: vår katalog och CM stavar likadant men inte alltid
  // med samma skiljetecken.
  // ⛔ Bara ENGELSKA set: CM:s episodlista är västerländsk, och japanska set bär
  // samma latinska namn ("Black Bolt"). Utan grinden hade en engelsk episod
  // skrivit sin logotyp och sitt släppdatum på det japanska setet.
  const all = await prisma.cardSet.findMany({
    where: { language: "EN" },
    select: { id: true, name: true, series: true, releaseDate: true, logoUrl: true, externalId: true, totalCards: true },
  });
  const existing = all.find((s) => norm(s.name) === norm(ep.name));

  if (existing) {
    const data: Record<string, unknown> = {};
    if (ep.logo && (FORCE || !existing.logoUrl)) data.logoUrl = ep.logo;
    if (released && (FORCE || !existing.releaseDate)) data.releaseDate = released;
    if (Object.keys(data).length === 0) {
      console.log(`Setet finns redan och har allt vi kan fylla: "${existing.name}" (${existing.id}).`);
      console.log("   (--force skriver över befintliga värden.)");
      return;
    }
    console.log(`\nFINNS: "${existing.name}" (${existing.id}, källa ${existing.externalId ?? "ingen externalId"})`);
    for (const [k, v] of Object.entries(data))
      console.log(`   ${k}: ${JSON.stringify((existing as any)[k] ?? null)} → ${JSON.stringify(v)}`);
    if (!APPLY) {
      console.log("\nTORRKÖRNING — kör om med --apply för att skriva.");
      return;
    }
    await prisma.cardSet.update({ where: { id: existing.id }, data });
    console.log("✅ Uppdaterat.");
    return;
  }

  const seriesExists = all.some((s) => s.series === series);
  console.log(
    `\nSKAPAR NYTT SET: "${ep.name}" · serie "${series}"${seriesExists ? "" : "  ⚠️ NY SERIE — dubbelkolla stavningen mot befintliga"}`
  );
  console.log(`   releaseDate: ${ep.released_at ?? "null"}`);
  console.log(`   logoUrl:     ${ep.logo ?? "null"}`);
  console.log(`   totalCards:  ${ep.cards_total ?? 0}${ep.cards_total ? "" : "  (CM har inte publicerat korten än)"}`);
  console.log(`   externalId:  null (pokemontcg.io adopterar raden när setet dyker upp där)`);
  if (!APPLY) {
    console.log("\nTORRKÖRNING — kör om med --apply för att skriva.");
    return;
  }
  const created = await prisma.cardSet.create({
    data: {
      name: ep.name,
      series,
      releaseDate: released,
      logoUrl: ep.logo,
      totalCards: ep.cards_total ?? 0,
    },
    select: { id: true },
  });
  console.log(`✅ Skapat: ${created.id}`);
  console.log(
    "   Kör därefter `import-sealed-from-cardmarket.ts` (RECENT_DAYS=90 APPLY=1) så får produkterna sin set-etikett."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
