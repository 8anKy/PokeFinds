/**
 * REVISION: vilka kort i katalogen prissätts av en 1st Edition-TRYCKNING?
 *
 * RapidAPI publicerar en rad per TRYCKNING (`version`) och pokemontcg.io:s `tcgid`
 * hänger på 1st Edition-raden i WOTC-seten → vår starkaste nyckel väljer systematiskt
 * den DYRASTE tryckningen, fast alla tryckningar delar EN CM-produkt (samma
 * `cardmarket_id`, samma `30d_average`) och länken vi visar går till den produkten.
 *
 *   # 1) svep sida 1 av alla episoder → vilka har flera tryckningar? (~1 anrop/episod)
 *   node scripts/with-prod-db.mjs npx tsx scripts/print-variant-audit.ts --sweep
 *   # 2) hämta ALLA sidor för de flaggade episoderna (cachas på disk)
 *   node scripts/with-prod-db.mjs npx tsx scripts/print-variant-audit.ts --fetch=171,170,168
 *   # 3) analysera mot vår DB (gratis, läser cachen)
 *   node scripts/with-prod-db.mjs npx tsx scripts/print-variant-audit.ts --report
 *
 * Skriver ALDRIG till DB. Skriver ALDRIG ut nyckeln.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/db";
import { getRatesOre } from "../src/lib/exchange-rate";
import { fetchCmGuide, singlesHeadlineEur } from "../src/jobs/cardmarket-refresh";

const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
const CACHE = process.env.PV_CACHE ?? join(process.cwd(), ".cache", "print-variants");

const args = process.argv.slice(2);
const SWEEP = args.includes("--sweep");
const FETCH = args.find((a) => a.startsWith("--fetch="))?.split("=")[1] ?? null;
const REPORT = args.includes("--report");

type Row = {
  name?: string | null;
  version?: string | null;
  tcgid?: string | null;
  cardmarket_id?: number | null;
  card_number?: string | number | null;
  episode?: { id?: number | null; name?: string | null } | null;
  prices?: { cardmarket?: { lowest_near_mint?: number | null; "30d_average"?: number | null } | null } | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(url: string): Promise<T | null> {
  const r = await fetch(url, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
  if (!r.ok) {
    console.error(`  HTTP ${r.status} ${url.replace(/^https:\/\/[^/]+/, "")}`);
    return null;
  }
  return (await r.json()) as T;
}

/** Är versionsetiketten en 1st Edition-tryckning? */
const isFirstEd = (v: string | null | undefined) => /1st\s*edition/i.test(v ?? "");

async function sweep() {
  // Episodlistan är PAGINERAD (20/sida) — ett barbent anrop gav 20 av ~180 episoder
  // och svepet flaggade därför noll. Följ paging.total, precis som jobbet gör.
  const list: { id: number; name?: string }[] = [];
  let page = 1, total = 1;
  do {
    const d = await api<{ data: { id: number; name?: string }[]; paging?: { total?: number } }>(
      `https://${HOST}/pokemon/episodes?page=${page}`
    );
    if (!d) break;
    total = d.paging?.total ?? 1;
    list.push(...(d.data ?? []));
    await sleep(220);
  } while (page++ < total);
  console.log(`${list.length} episoder (${total} sidor)\n`);
  const flagged: { id: number; name: string; versions: string[] }[] = [];
  for (const ep of list) {
    const d = await api<{ data: Row[]; paging?: { total?: number } }>(
      `https://${HOST}/pokemon/episodes/${ep.id}/cards?page=1`
    );
    await sleep(220);
    const rows = d?.data ?? [];
    if (!rows.length) continue;
    const versions = [...new Set(rows.map((r) => r.version ?? "(ingen)"))];
    if (versions.some((v) => isFirstEd(v))) {
      flagged.push({ id: ep.id, name: ep.name ?? "?", versions });
      console.log(`FLAGGAD  ${String(ep.id).padStart(4)} ${(ep.name ?? "?").padEnd(34)} ${versions.join(" | ")}`);
    }
  }
  console.log(`\n${flagged.length} episoder med 1st Edition-tryckningar:`);
  console.log(`--fetch=${flagged.map((f) => f.id).join(",")}`);
}

async function fetchEpisodes(ids: number[]) {
  mkdirSync(CACHE, { recursive: true });
  for (const id of ids) {
    const rows: Row[] = [];
    const first = await api<{ data: Row[]; paging?: { total?: number } }>(
      `https://${HOST}/pokemon/episodes/${id}/cards?page=1`
    );
    await sleep(220);
    if (!first?.data?.length) {
      console.log(`episod ${id}: tom`);
      continue;
    }
    rows.push(...first.data);
    const pages = Math.max(1, first.paging?.total ?? 1);
    for (let pg = 2; pg <= pages; pg++) {
      const d = await api<{ data: Row[] }>(`https://${HOST}/pokemon/episodes/${id}/cards?page=${pg}`);
      await sleep(220);
      if (d?.data?.length) rows.push(...d.data);
    }
    writeFileSync(join(CACHE, `${id}.json`), JSON.stringify(rows));
    console.log(`episod ${id} "${rows[0]?.episode?.name ?? "?"}": ${rows.length} rader, ${pages} sidor → cache`);
  }
}

async function report() {
  if (!existsSync(CACHE)) throw new Error(`ingen cache i ${CACHE} — kör --fetch först`);
  // BARA episod-cachen: report.json ligger i samma katalog och lästes tidigare in som
  // 136 extra "feed-rader" utan version → förorenade täckningstabellen.
  const files = readdirSync(CACHE).filter((f) => /^\d+\.json$/.test(f));
  // EPISODEN MÅSTE KOMMA FRÅN FILEN. Feed-raderna bär `episode.name` men inte alltid
  // `episode.id`, och en gruppering på `episode?.id ?? "?"` föll ihop till bara
  // samlarnumret → Base #12 (Ninetales) grupperades med Neo Destiny #12 och fick en
  // "alternativ tryckning" ur ett helt annat set. Filnamnet ÄR episod-id:t.
  const rows: Row[] = files.flatMap((f) => {
    const epId = parseInt(f, 10);
    return (JSON.parse(readFileSync(join(CACHE, f), "utf8")) as Row[]).map((r) => ({
      ...r,
      episode: { ...(r.episode ?? {}), id: epId },
    }));
  });
  console.log(`${rows.length} feed-rader ur ${files.length} episoder\n`);

  // Per-version prisTÄCKNING: har tryckningen ens ett From-värde?
  const cov = new Map<string, { n: number; priced: number }>();
  for (const r of rows) {
    const v = r.version ?? "(ingen)";
    const c = cov.get(v) ?? { n: 0, priced: 0 };
    c.n++;
    if ((r.prices?.cardmarket?.lowest_near_mint ?? 0) > 0) c.priced++;
    cov.set(v, c);
  }
  console.log("Prisstäckning per tryckning (rader med lowest_near_mint):");
  for (const [v, c] of [...cov.entries()].sort((a, b) => b[1].n - a[1].n))
    console.log(`  ${v.padEnd(26)} ${String(c.priced).padStart(5)}/${String(c.n).padEnd(5)} (${((c.priced / c.n) * 100).toFixed(0)}%)`);

  // Vad vår matchare gör i dag: tcgid-raden vinner. KORTETS identitet är
  // (episod, samlarnummer) — INTE cardmarket_id: Unlimited-raden har ofta
  // `cardmarket_id: null`, så en gruppering på cmid tappar just den tryckning
  // katalogen faktiskt representerar.
  const byTcgid = new Map<string, Row[]>();
  for (const r of rows) if (r.tcgid) {
    if (!byTcgid.has(r.tcgid)) byTcgid.set(r.tcgid, []);
    byTcgid.get(r.tcgid)!.push(r);
  }
  const byCard = new Map<string, Row[]>();
  const cardKey = (r: Row) => `${r.episode?.id ?? "?"}|${String(r.card_number ?? "?")}`;
  for (const r of rows) {
    const k = cardKey(r);
    if (!byCard.has(k)) byCard.set(k, []);
    byCard.get(k)!.push(r);
  }

  const rates = await getRatesOre();
  const cards = await prisma.card.findMany({
    where: { tcgExternalId: { in: [...byTcgid.keys()] } },
    select: {
      tcgExternalId: true, name: true, number: true,
      set: { select: { name: true } },
      products: {
        select: {
          id: true, slug: true,
          offers: { select: { price: true, url: true, retailer: { select: { name: true } } } },
        },
      },
    },
  });
  console.log(`\n${cards.length} av våra kort matchar en 1st Edition-bärande tcgid\n`);

  // Hur många av korten prissätts fortfarande av en 1st Edition-rad? (Regeln i
  // feedRowWins låter den vinna bara när ingen annan tryckning har ett äkta From.)
  let pricedByFirstEd = 0;
  for (const c of cards) {
    const winner = (byTcgid.get(c.tcgExternalId!) ?? [])[0];
    if (!winner || !isFirstEd(winner.version)) continue;
    const siblings = (byCard.get(cardKey(winner)) ?? [])
      .filter((s) => !isFirstEd(s.version) && (s.prices?.cardmarket?.lowest_near_mint ?? 0) > 0);
    if (siblings.length === 0) pricedByFirstEd++;
  }
  console.log(`${pricedByFirstEd} kort har INGEN tryckning utom 1st Edition med ett aekta From`);
  console.log(`  → de prissaetts fortfarande av 1st Edition-raden (oeppen post, se CLAUDE.md)
`);


  // ── FACIT: pokemontcg.io publicerar CM-priser för den ORDINARIE produkten ──────
  // (dess `cardmarket.url` är just den V1/V2-produkt våra offers redan länkar till).
  // Gratis, nyckellöst, ingen RapidAPI-kvot. Används HÄR bara som oberoende
  // mätsticka — inte som pris.
  const setIds = [...new Set(cards.map((c) => c.tcgExternalId!.split("-")[0]))];
  type Ref = { trend: number | null; low: number | null; avg: number | null; url?: string | null };
  const tcgTrend = new Map<string, Ref>();
  // Nyckellös pokemontcg.io strypar efter några hundra kort → cacha på disk.
  const ptcgFile = join(CACHE, "ptcg.json");
  if (existsSync(ptcgFile)) {
    for (const [k, v] of Object.entries(JSON.parse(readFileSync(ptcgFile, "utf8")) as Record<string, Ref>))
      tcgTrend.set(k, v);
    console.log(`pokemontcg.io: ${tcgTrend.size} kort ur diskcache`);
  }
  for (const sid of tcgTrend.size ? [] : setIds) {
    for (let pg = 1; pg <= 4; pg++) {
      // `select` gav HTTP 500 på 7 av 10 set → hämta hela kortet i stället.
      let r = await fetch(`https://api.pokemontcg.io/v2/cards?q=set.id:${sid}&pageSize=250&page=${pg}`);
      if (!r.ok) {
        await sleep(1200);
        r = await fetch(`https://api.pokemontcg.io/v2/cards?q=set.id:${sid}&pageSize=250&page=${pg}`);
      }
      if (!r.ok) { console.error(`  pokemontcg.io HTTP ${r.status} för ${sid}`); break; }
      const d = (await r.json()) as {
        data: { id: string; cardmarket?: { url?: string; prices?: Record<string, number | null> } }[];
      };
      for (const c of d.data ?? []) {
        const p = c.cardmarket?.prices ?? {};
        tcgTrend.set(c.id, {
          trend: p.trendPrice ?? null, low: p.lowPrice ?? null, avg: p.averageSellPrice ?? null,
          url: c.cardmarket?.url ?? null,
        });
      }
      if ((d.data ?? []).length < 250) break;
    }
    await sleep(150);
  }
  if (tcgTrend.size) writeFileSync(ptcgFile, JSON.stringify(Object.fromEntries(tcgTrend)));
  console.log(`pokemontcg.io: CM-referens för ${tcgTrend.size} kort i ${setIds.length} set\n`);

  // Mät ALLA 940: hur långt ifrån den ordinarie produktens trend ligger det vi publicerar?
  const ratios: { label: string; ourEur: number; trend: number; ratio: number; firstEd: boolean }[] = [];
  for (const c of cards) {
    const prod = c.products[0];
    const cmOffer = prod?.offers.find((o) => o.retailer?.name === "Cardmarket");
    if (!cmOffer?.price) continue;
    const ref = tcgTrend.get(c.tcgExternalId!);
    if (!ref?.trend || ref.trend <= 0) continue;
    const ourEur = cmOffer.price / rates.eurToOre;
    const winner = (byTcgid.get(c.tcgExternalId!) ?? [])[0];
    ratios.push({
      label: `${c.name} · ${c.set?.name} ${c.number}`,
      ourEur, trend: ref.trend, ratio: ourEur / ref.trend,
      firstEd: isFirstEd(winner?.version),
    });
  }
  const over3 = ratios.filter((r) => r.ratio >= 3);
  const fe = ratios.filter((r) => r.firstEd);
  const notFe = ratios.filter((r) => !r.firstEd);
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
  console.log(`FACIT mot pokemontcg.io:s CM-trend (ordinarie produkten), ${ratios.length} kort med båda värden:`);
  console.log(`  1st Edition-prissatta (${fe.length}):     median ${med(fe.map((r) => r.ratio)).toFixed(1)}x trenden, ${fe.filter((r) => r.ratio >= 3).length} st ≥3x`);
  console.log(`  övriga tryckningar   (${notFe.length}):     median ${med(notFe.map((r) => r.ratio)).toFixed(1)}x trenden, ${notFe.filter((r) => r.ratio >= 3).length} st ≥3x`);
  console.log(`  totalt ≥3x över trenden: ${over3.length}\n`);
  over3.sort((a, b) => b.ratio - a.ratio);
  console.log(`  De ${Math.min(25, over3.length)} värsta (vårt pris vs ordinarie produktens trend):`);
  for (const r of over3.slice(0, 25))
    console.log(`    ${r.ratio.toFixed(0).padStart(5)}x  ${(r.ourEur.toFixed(2) + " €").padStart(11)} mot trend ${(r.trend.toFixed(2) + " €").padEnd(10)} ${r.label}`);
  console.log("");

}

async function main() {
  if (SWEEP || FETCH) if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas i .env");
  if (SWEEP) await sweep();
  if (FETCH) await fetchEpisodes(FETCH.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0));
  if (REPORT) await report();
  if (!SWEEP && !FETCH && !REPORT) console.log("ange --sweep, --fetch=1,2,3 eller --report");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
