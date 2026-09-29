/**
 * LÄGGER TILL KORT SOM SAKNAS I ETT SET — ur TCGdex, ALDRIG en ändring av befintliga rader.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/import-missing-cards-tcgdex.ts            (torrkörning, alla set nedan)
 *   node scripts/with-prod-db.mjs npx tsx scripts/import-missing-cards-tcgdex.ts --apply
 *   ... --set mep                                                                           (bara ett set)
 *
 * VARFÖR (2026-09-30): promo- och energiset VÄXER efter släppet, och ingen import fyllde på dem.
 * MEP-promona importerades EN gång i juni (import-mep-promos.ts) och stannade på nr 81 medan
 * TCGdex listar 112 — ETB-promon Nidorina MEP 101, Greninja ex MEP 099 m.fl. fanns inte i sök,
 * skanner eller bevakning. pokemontcg.io släpar (och svarade 500 i september), leverantören
 * saknar Mega Evolution Energy helt. TCGdex (gratis, MIT) har korten OCH Cardmarkets idProduct.
 *
 * ⛔ ADD-ONLY. De två äldre skripten kunde inte användas: import-mep-promos.ts skriver om titel +
 *    pris på varje befintligt promo, import-en-set-from-provider.ts matchar på sitt eget id och
 *    hade skapat dubbletter av 73 befintliga. Här hoppas ett kort över om setet redan har samma
 *    NUMMER (normaliserat: "MEP 081" = "81" = "081"), eller om dess idProduct redan bärs av ett kort.
 * ⛔ `tcgExternalId` lämnas NULL med flit: pokemontcg.io-importen adopterar då raden på
 *    set + nummer + namn när den kommer ikapp (import-tcg-data.ts) i stället för att skapa en tvilling.
 * PRIS: inget offer skrivs — `Card.cardmarketId` räcker, cardmarket-refresh prissätter och bygger
 *    konstavtryck (sista steget). Hellre "–" ett dygn än ett pris ur en annan väg.
 * BILD: TCGdex `image` + "/high.png"; saknas den tas leverantörens bild via cardmarket_id om en
 *    episod finns för setet. Kort utan bild skapas ändå (sök + bevakning) och redovisas.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { normalizeTitle, slugify } from "@/lib/utils";
import { TCGDEX_BASE, tcgdexJson } from "@/lib/tcgdex";
import { exitJob } from "@/lib/job-exit";

const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";

/**
 * Seten som växer efter släppet. `numberFormat` följer setets BEFINTLIGA rader (så en
 * pokemontcg.io-adoption och vår egen nummerjämförelse möts): MEP bär leverantörens
 * "MEP 081", pokemontcg.io-seten bär localId utan inledande nollor.
 * `episode` = leverantörens episod, bara som BILDreserv.
 */
const SETS: { tcgdex: string; numberFormat: (localId: string) => string; episode?: number; scrydex?: string }[] = [
  { tcgdex: "mep", scrydex: "mep", numberFormat: (l) => `MEP ${l.replace(/\D/g, "").padStart(3, "0")}`, episode: 412 },
  { tcgdex: "svp", scrydex: "svp", numberFormat: stripZeros, episode: 23 },
  { tcgdex: "sve", scrydex: "sve", numberFormat: stripZeros, episode: 20 },
  { tcgdex: "mee", scrydex: "mee", numberFormat: stripZeros },
  { tcgdex: "swshp", scrydex: "swshp", numberFormat: (l) => l },
  // ⛔ ecard2 (Aquapolis) står INTE här: de saknade är a/b-varianter som delar ETT idProduct.
  { tcgdex: "2023sv", scrydex: "mcd23", numberFormat: stripZeros, episode: 639 },
  { tcgdex: "2024sv", scrydex: "mcd24", numberFormat: stripZeros, episode: 638 },
];

/** Samma titelform som import-tcg-data / import-en-set-from-provider ("Namn · Set N/Total"). */
function enProductTitle(name: string, setName: string, number: string, printedTotal: number | null): string {
  const denom = printedTotal && printedTotal > 0 ? `/${printedTotal}` : "";
  return `${name} · ${setName} ${number}${denom}`;
}

function stripZeros(l: string): string {
  return l.replace(/^0+(?=\d)/, "");
}

/**
 * Jämförelsenyckel för nummer INOM ett set: siffror utan nollor + eventuellt bokstavssuffix.
 * Setets eget prefix ignoreras — MEP bär både "065" och "MEP 081" i samma set (två importer),
 * och "SWSH007" är alltid SWSH i swshp. ("MEP 081" → "81", "065" → "65", "50a" → "50A".)
 */
function numberKey(n: string): string {
  const m = /^[A-Za-z]*\s*0*(\d+)([A-Za-z]*)$/.exec(n.trim());
  return m ? `${m[1]}${m[2].toUpperCase()}` : n.trim().toUpperCase();
}

interface TcgdexSet {
  id: string;
  name: string;
  releaseDate?: string;
  logo?: string;
  serie?: { name?: string };
  cardCount?: { total?: number; official?: number };
  cards: { id: string; localId: string; name: string; image?: string }[];
}
interface TcgdexCard {
  id: string;
  localId: string;
  name: string;
  image?: string;
  rarity?: string;
  hp?: number;
  illustrator?: string;
  pricing?: { cardmarket?: { idProduct?: number | null } | null } | null;
}

async function providerImages(episode: number): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!KEY) return out;
  for (let page = 1; page <= 30; page++) {
    const r = await fetch(`https://${HOST}/pokemon/episodes/${episode}/cards?page=${page}`, {
      headers: { "x-rapidapi-key": KEY, "x-rapidapi-host": HOST },
    });
    if (!r.ok) break;
    const d = (await r.json()) as { data: { cardmarket_id: number | null; image?: string | null }[]; paging?: { total?: number } };
    for (const c of d.data) if (c.cardmarket_id && c.image) out.set(c.cardmarket_id, c.image);
    if (d.data.length === 0 || (d.paging?.total != null && page >= d.paging.total)) break;
    await new Promise((res) => setTimeout(res, 220));
  }
  return out;
}

/**
 * BILDRESERV: Scrydex (äger pokemontcg.io) har bilder som TCGdex saknar — men svarar 200 med
 * KORTETS BAKSIDA för okända id:n (samma fil för alla, se fix-card-images.ts). Därför: samma
 * bytes för två kort = platshållare, och kortformat (~0,717) + bredd ≥ 400 krävs.
 */
const seenScrydex = new Map<string, string>();
async function scrydexImage(id: string): Promise<string | null> {
  const url = `https://images.scrydex.com/pokemon/${encodeURIComponent(id)}/large`;
  try {
    const res = await fetch(url, { headers: { "user-agent": "Foilio/1.0 (+https://foilio.se)" } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const md5 = createHash("md5").update(buf).digest("hex");
    const owner = seenScrydex.get(md5);
    if (owner && owner !== id) return null;
    seenScrydex.set(md5, id);
    const m = await sharp(buf).metadata();
    const ratio = (m.width ?? 0) / (m.height ?? 1);
    if ((m.width ?? 0) < 400 || ratio < 0.68 || ratio > 0.76) return null;
    return url;
  } catch {
    return null;
  }
}

/** Scrydex-id:t för ett av våra kort: `<set>-<nummer>` ("mep-99", "swshp-SWSH299", "mcd24-1"). */
function scrydexId(scrydexSet: string, number: string): string {
  const n = scrydexSet === "swshp" ? number : number.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return `${scrydexSet}-${n}`;
}

async function main() {
  // Baksidans hash i förväg: ett id som inte finns ger platshållaren, och den får aldrig bli en bild.
  await scrydexImage("mcd24-0-placeholder-probe");
  await scrydexImage("2024sv-1");
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const only = args.includes("--set") ? args[args.indexOf("--set") + 1] : null;
  let total = 0;

  for (const cfg of SETS.filter((s) => !only || s.tcgdex === only)) {
    const ts = await tcgdexJson<TcgdexSet>(`${TCGDEX_BASE}/en/sets/${cfg.tcgdex}`);
    if (!ts) {
      console.log(`${cfg.tcgdex}: finns inte hos TCGdex`);
      continue;
    }
    let set = await prisma.cardSet.findFirst({
      where: { externalId: cfg.tcgdex },
      select: { id: true, name: true, totalCards: true },
    });
    const existing = set
      ? await prisma.card.findMany({ where: { setId: set.id }, select: { number: true } })
      : [];
    const have = new Set(existing.map((c) => numberKey(c.number)));
    const missing = ts.cards.filter((c) => !have.has(numberKey(cfg.numberFormat(c.localId))));
    console.log(`\n${cfg.tcgdex} "${ts.name}": TCGdex ${ts.cards.length}, vi ${existing.length}${set ? "" : " (SET SAKNAS)"} → saknas ${missing.length}`);
    if (missing.length === 0) continue;

    if (!set && apply) {
      set = await prisma.cardSet.create({
        data: {
          name: ts.name,
          series: ts.serie?.name ?? "Unknown",
          language: "EN",
          externalId: cfg.tcgdex,
          releaseDate: ts.releaseDate ? new Date(ts.releaseDate) : new Date(),
          logoUrl: ts.logo ? `${ts.logo}.png` : null,
          totalCards: ts.cardCount?.official ?? 0,
          totalCardsFull: ts.cardCount?.total ?? 0,
        },
        select: { id: true, name: true, totalCards: true },
      });
      console.log(`  skapade set ${set.id}`);
    }
    const images = cfg.episode ? await providerImages(cfg.episode) : new Map<number, string>();
    const printedTotal = set && set.totalCards > 0 ? set.totalCards : null;

    for (const m of missing) {
      const c = await tcgdexJson<TcgdexCard>(`${TCGDEX_BASE}/en/cards/${encodeURIComponent(m.id)}`);
      if (!c) continue;
      const number = cfg.numberFormat(c.localId);
      const cmId = c.pricing?.cardmarket?.idProduct ?? null;
      const cmTaken = cmId
        ? await prisma.card.findUnique({ where: { cardmarketId: cmId }, select: { id: true, name: true, number: true } })
        : null;
      const imageUrl = c.image ? `${c.image}/high.png` : cmId ? images.get(cmId) ?? null : null;
      if (cmTaken) {
        console.log(`  = ${c.name} ${number}: idProduct ${cmId} bärs redan av ${cmTaken.name} ${cmTaken.number} — hoppar`);
        continue;
      }
      console.log(`  + ${c.name} ${number} (${c.rarity ?? "?"}) cm=${cmId ?? "-"}${imageUrl ? "" : " ⚠️ ingen bild"}`);
      total++;
      if (!apply || !set) continue;

      const card = await prisma.card.create({
        data: {
          setId: set.id,
          number,
          name: c.name,
          rarity: c.rarity ?? "Promo",
          imageUrl,
          language: "EN",
          hp: c.hp ?? null,
          artist: c.illustrator ?? null,
          ...(cmId ? { cardmarketId: cmId } : {}),
        },
        select: { id: true },
      });
      const title = enProductTitle(c.name, set.name, number, printedTotal);
      const baseSlug = slugify(`${c.name}-${cfg.tcgdex}-${number}`);
      const slug = (await prisma.product.findUnique({ where: { slug: baseSlug }, select: { id: true } }))
        ? `${baseSlug}-${c.id}`
        : baseSlug;
      await prisma.product.create({
        data: {
          title,
          normalizedTitle: normalizeTitle(title),
          slug,
          category: "SINGLE_CARD",
          cardId: card.id,
          setId: set.id,
          imageUrl,
          language: "EN",
        },
      });
    }
  }
  // BILDPASS: kort i seten ovan som saknar bild får Scrydex-bilden (verifierad) — både nya och äldre.
  let filled = 0;
  for (const cfg of SETS.filter((s) => (!only || s.tcgdex === only) && s.scrydex)) {
    const bare = await prisma.card.findMany({
      where: { set: { externalId: cfg.tcgdex }, imageUrl: null },
      select: { id: true, number: true, name: true },
    });
    for (const c of bare) {
      const url = await scrydexImage(scrydexId(cfg.scrydex!, c.number));
      if (!url) continue;
      filled++;
      console.log(`  🖼 ${c.name} ${c.number} ← ${url}`);
      if (!apply) continue;
      await prisma.card.update({ where: { id: c.id }, data: { imageUrl: url } });
      await prisma.product.updateMany({ where: { cardId: c.id, imageUrl: null }, data: { imageUrl: url } });
    }
  }
  console.log(`Bilder ur Scrydex: ${filled}${apply ? " skrivna" : " (torrkörning)"}.`);

  console.log(`\n${apply ? "Skapade" : "Skulle skapa"}: ${total} kort.${apply ? "" : " (torrkörning — --apply skriver)"}`);
  if (apply && total > 0) console.log("Nästa: cardmarket-refresh prissätter via cardmarketId och bygger konstavtryck.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => exitJob());
