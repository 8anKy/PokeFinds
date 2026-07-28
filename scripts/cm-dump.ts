/**
 * DUMPA CARDMARKET-DATAN FÖR ETT HELT SET till en fil du kan öppna.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-dump.ts Base
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-dump.ts "Neo Destiny"
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-dump.ts --episode=171
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-dump.ts Base --refresh   # hämta om från API:t
 *
 * Skriver TVÅ filer till .cache/cm-dump/:
 *   <set>.csv    öppnas i Excel (semikolon + decimalkomma, UTF-8 med BOM)
 *   <set>.json   samma rader som JSON
 *
 * Varje rad = en TRYCKNING av ett kort, med API:ts pris, CM:s guide-pris och vad
 * VI publicerar bredvid varandra — så det syns direkt var API:t saknar eller
 * ljuger om ett pris.
 *
 * KVOT: ~1 anrop per 20 kort i setet (Base ≈ 16). Episodlistan och kortsvaren
 * cachas på disk och återanvänds; --refresh hämtar om. CM:s prisguide är en
 * GRATIS nedladdning utan nyckel (ingen kvot).
 *
 * Skriver ALDRIG till databasen.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/db";

const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
const CACHE = join(process.cwd(), ".cache");
const EPISODES = join(CACHE, "print-variants");
const OUT = join(CACHE, "cm-dump");
const GUIDE_URL = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";

const args = process.argv.slice(2);
const REFRESH = args.includes("--refresh");
const EPISODE_ARG = args.find((a) => a.startsWith("--episode="))?.split("=")[1];
const SET_TERM = args.filter((a) => !a.startsWith("--")).join(" ").trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ApiRow {
  name?: string | null; card_number?: string | number | null; version?: string | null;
  tcgid?: string | null; cardmarket_id?: number | null; rarity?: string | null;
  episode?: { id?: number | null; name?: string | null } | null;
  prices?: { cardmarket?: {
    lowest_near_mint?: number | null; lowest_near_mint_EU_only?: number | null;
    "30d_average"?: number | null; "7d_average"?: number | null; available_items?: number | null;
  } | null } | null;
}
interface GuideRow { idProduct: number; low?: number | null; trend?: number | null; avg?: number | null; avg7?: number | null; avg30?: number | null }

async function api<T>(url: string): Promise<T | null> {
  const r = await fetch(url, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
  if (!r.ok) { console.error(`  HTTP ${r.status} ${url.replace(/^https:\/\/[^/]+/, "")}`); return null; }
  return (await r.json()) as T;
}

/** Episodlistan är paginerad (20/sida) — cachas på disk, den ändras sällan. */
async function episodeList(): Promise<{ id: number; name: string }[]> {
  const file = join(EPISODES, "episodes.json");
  if (existsSync(file) && !REFRESH) return JSON.parse(readFileSync(file, "utf8"));
  const list: { id: number; name: string }[] = [];
  let page = 1, total = 1;
  do {
    const d = await api<{ data: { id: number; name?: string }[]; paging?: { total?: number } }>(
      `https://${HOST}/pokemon/episodes?page=${page}`
    );
    if (!d) break;
    total = d.paging?.total ?? 1;
    list.push(...(d.data ?? []).map((e) => ({ id: e.id, name: e.name ?? "?" })));
    await sleep(220);
  } while (page++ < total);
  mkdirSync(EPISODES, { recursive: true });
  writeFileSync(file, JSON.stringify(list));
  return list;
}

/** Alla kortrader för en episod. Cachas per episod-id (samma cache som print-variant-audit). */
async function episodeCards(id: number): Promise<ApiRow[]> {
  const file = join(EPISODES, `${id}.json`);
  if (existsSync(file) && !REFRESH) {
    console.log(`Kortdata: diskcache ${file.replace(process.cwd(), ".")} (--refresh hämtar nytt).`);
    return JSON.parse(readFileSync(file, "utf8"));
  }
  const rows: ApiRow[] = [];
  const first = await api<{ data: ApiRow[]; paging?: { total?: number } }>(`https://${HOST}/pokemon/episodes/${id}/cards?page=1`);
  if (!first?.data?.length) return [];
  rows.push(...first.data);
  // SIDANTALET LÄSES UR SVARET, aldrig ur episodens `cards_total` — den ljuger
  // (0 för både MEP och Pitch Black), vilket lämnade hela set utan data.
  const pages = Math.max(1, first.paging?.total ?? 1);
  console.log(`Hämtar ${pages} sidor från API:t…`);
  for (let pg = 2; pg <= pages; pg++) {
    const d = await api<{ data: ApiRow[] }>(`https://${HOST}/pokemon/episodes/${id}/cards?page=${pg}`);
    await sleep(220);
    if (d?.data?.length) rows.push(...d.data);
  }
  mkdirSync(EPISODES, { recursive: true });
  writeFileSync(file, JSON.stringify(rows));
  return rows;
}

function loadGuide(): Map<number, GuideRow> {
  const file = join(CACHE, "cardmarket", "price_guide_6.json");
  const json = JSON.parse(readFileSync(file, "utf8")) as { priceGuides: GuideRow[] };
  return new Map(json.priceGuides.map((g) => [g.idProduct, g]));
}

async function main() {
  if (!SET_TERM && !EPISODE_ARG) {
    console.log('Ange ett set: npx tsx scripts/cm-dump.ts Base   (eller --episode=171)');
    return;
  }
  if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas i miljön");
  const guideFile = join(CACHE, "cardmarket", "price_guide_6.json");
  if (!existsSync(guideFile)) {
    console.log("Hämtar CM:s prisguide (gratis, ~14 MB)…");
    const r = await fetch(GUIDE_URL);
    mkdirSync(join(CACHE, "cardmarket"), { recursive: true });
    writeFileSync(guideFile, await r.text());
  }

  let epId = EPISODE_ARG ? parseInt(EPISODE_ARG, 10) : NaN;
  let epName = EPISODE_ARG ?? "";
  if (!Number.isFinite(epId)) {
    const eps = await episodeList();
    const hits = eps.filter((e) => e.name.toLowerCase().includes(SET_TERM.toLowerCase()));
    if (hits.length === 0) { console.log(`Hittade ingen episod som matchar "${SET_TERM}".`); await prisma.$disconnect(); return; }
    if (hits.length > 1) console.log(`Flera träffar: ${hits.map((h) => `${h.name} (${h.id})`).join(", ")} — tar den första.`);
    epId = hits[0].id; epName = hits[0].name;
  }
  console.log(`Episod ${epId} "${epName || SET_TERM}"`);

  const rows = await episodeCards(epId);
  if (rows.length === 0) { console.log("API:t gav inga rader."); await prisma.$disconnect(); return; }
  // Namnet i SVARET vinner: med --episode=171 är epName annars "171", och då
  // hittas inget CardSet → kolumnerna med VÅRA priser hade blivit tomma.
  epName = rows[0]?.episode?.name || epName || String(epId);
  const guide = loadGuide();

  // Vad VI publicerar för samma kort (matchas på setnamn + kortnummer).
  const ourSet = await prisma.cardSet.findFirst({ where: { name: epName }, select: { id: true } });
  const ours = ourSet
    ? await prisma.product.findMany({
        where: { setId: ourSet.id, category: "SINGLE_CARD" },
        select: {
          title: true, variantLabel: true, lowestPriceOre: true,
          card: { select: { number: true } },
          offers: { where: { retailer: { name: "Cardmarket" } }, select: { price: true, url: true, stockStatus: true }, take: 1 },
        },
      })
    : [];
  const num = (v: unknown) => String(v ?? "").replace(/^[A-Za-z]+\s*/, "").trim();
  const oursByNum = new Map<string, typeof ours>();
  for (const p of ours) {
    const k = num(p.card?.number);
    oursByNum.set(k, [...(oursByNum.get(k) ?? []), p]);
  }

  const out = rows.map((r) => {
    const c = r.prices?.cardmarket ?? {};
    const g = r.cardmarket_id != null ? guide.get(r.cardmarket_id) : undefined;
    const mine = (oursByNum.get(num(r.card_number)) ?? []).find(
      (p) => (p.variantLabel ?? "") === (r.version?.includes("1st") ? "1st Edition" : r.version ?? "")
    ) ?? (oursByNum.get(num(r.card_number)) ?? [])[0];
    const cmOffer = mine?.offers[0];
    return {
      set: epName,
      nummer: num(r.card_number),
      kort: r.name ?? "",
      tryckning: r.version ?? "",
      cm_produkt: r.cardmarket_id ?? null,
      from_eur: c.lowest_near_mint ?? null,
      eu_from_eur: c.lowest_near_mint_EU_only ?? null,
      snitt7d_eur: c["7d_average"] ?? null,
      snitt30d_eur: c["30d_average"] ?? null,
      annonser: c.available_items ?? null,
      guide_low_eur: g?.low ?? null,
      guide_trend_eur: g?.trend ?? null,
      guide_avg30_eur: g?.avg30 ?? null,
      vår_produkt: mine?.title ?? "",
      vårt_pris_kr: mine?.lowestPriceOre != null ? mine.lowestPriceOre / 100 : null,
      vår_cm_offer_kr: cmOffer?.price != null ? cmOffer.price / 100 : null,
      vår_lagerstatus: cmOffer?.stockStatus ?? "",
      vår_länk: cmOffer?.url ?? "",
      anmärkning: [
        c.lowest_near_mint == null ? "INGET From" : "",
        c.lowest_near_mint == null && (c.available_items ?? 0) > 0 ? `${c.available_items} annonser utan From` : "",
        c.lowest_near_mint != null && g?.trend != null && g.trend > 0 && c.lowest_near_mint / g.trend >= 10
          ? `From är ${(c.lowest_near_mint / g.trend).toFixed(0)}x guidens trend` : "",
        c.lowest_near_mint != null && g?.trend != null && c.lowest_near_mint > 0 && g.trend / c.lowest_near_mint >= 10
          ? `From är ${(g.trend / c.lowest_near_mint).toFixed(0)}x UNDER guidens trend` : "",
      ].filter(Boolean).join("; "),
    };
  });

  mkdirSync(OUT, { recursive: true });
  const slug = epName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || String(epId);
  writeFileSync(join(OUT, `${slug}.json`), JSON.stringify(out, null, 1));
  const cols = Object.keys(out[0]);
  const cell = (v: unknown) =>
    v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : `"${String(v).replace(/"/g, '""')}"`;
  writeFileSync(
    join(OUT, `${slug}.csv`),
    "﻿" + [cols.join(";"), ...out.map((r) => cols.map((k) => cell((r as Record<string, unknown>)[k])).join(";"))].join("\r\n")
  );

  const noFrom = out.filter((r) => r.from_eur == null).length;
  const listedNoFrom = out.filter((r) => r.from_eur == null && (r.annonser ?? 0) > 0).length;
  const odd = out.filter((r) => r.anmärkning.includes("x guidens") || r.anmärkning.includes("UNDER")).length;
  console.log(
    `\n${out.length} rader (en per tryckning).\n` +
    `  utan From:                 ${noFrom}\n` +
    `  varav MED annonser ändå:   ${listedNoFrom}\n` +
    `  From ≥10x från guiden:     ${odd}\n\n` +
    `Filer:\n  ${join(OUT, `${slug}.csv`)}\n  ${join(OUT, `${slug}.json`)}`
  );
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
