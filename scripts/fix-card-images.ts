/**
 * LAGAR DÖDA KORTBILDER — och de bildlösa produkterna som hänger på dem.
 *
 * Två fel, samma orsak: en HOTLINK vi inte äger slutade svara.
 *  A) pokemontcg.io 404:ar för ett fåtal promos (svp 102, hsp HGSS18).
 *  B) **TCGGO ROTERAR SINA STORAGE-ID:N.** MÄTT 2026-08-03: alla 82 MEP-kort
 *     pekade på `…/storage/34134/meganium-mep-mep-001-….png` (404 idag) medan
 *     API:t samma dag svarade `…/storage/36834/meganium-mep-1-….png` (200).
 *     Både id OCH filnamnsslug hade bytts. Bilderna FINNS alltså — vår kopia av
 *     adressen är det som ruttnat.
 *
 * ⛔ DÄRFÖR FLYTTAS INTE McDonald's-KORTEN TILL TCGGO. Den ursprungliga planen
 * var att flytta de 48 mcd-korten från TCGplayers CDN till TCGGO (vår betalda
 * leverantör). Rotationen ovan är ett MÄTT skäl att låta bli: de 48 fungerar
 * idag, har avtryck, och skulle bytas mot en adress som bevisligen ruttnar.
 * En fungerande bild rörs aldrig av det här skriptet.
 *
 * KÄLLOR, I FALLANDE ÖNSKVÄRDHET:
 *  1. **TCGGO** — vår befintliga, betalda prisleverantör, och den enda som har
 *     MEP-seten. Kostar RapidAPI-kvot: 1 anrop per set (episodlistan cachas) +
 *     ~1 per 20 kort. Hela luckan går på ~10 anrop av 3000/dygn.
 *  2. **CardTrader** — GRATIS med vår befintliga token, ingen kvot. Blueprintens
 *     `image_url`. Matchas på samlarnummer + namn inom den mappade expansionen.
 *  3. **TCGdex** (MIT) → 4. **TCGplayers CDN** via TCGdex `tcgplayer.productId`.
 *     ⚠️ Licensläget för (4) är okänt; reversibelt (bryts hotlinken är vi
 *     tillbaka i dagens läge, inte värre).
 *
 * ⛔ SKRIVER ALDRIG EN OVERIFIERAD URL. Varje kandidat hämtas och måste svara 200
 * med bild-content-type. En trasig URL som ersätter en annan döljer bara felet.
 *
 * ⛔ MATCHNINGEN MÅSTE KLARA KORT UTAN `tcgExternalId`. MEP-korten kom in via
 * Cardmarket-importen, inte från pokemontcg.io, så de har inget tcgid alls — och
 * det är de 82 korten som är hela luckan. För dem är `Card.cardmarketId` mot
 * TCGGO:s `cardmarket_id` en EXAKT join, vilket är viktigt just här: setet har
 * flera kort per nummer (staff-promos), så nummer+namn ensamt är tvetydigt.
 *
 * ⛔ PRODUKTEN ÄR DET ANVÄNDAREN SER. Kortets bild lagar skannern; katalogsidan
 * läser `Product.imageUrl`. MEP-produkterna stod på `null`. Båda skrivs.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-card-images.ts          # torrt
 *   APPLY=1 node scripts/with-prod-db.mjs npx tsx scripts/fix-card-images.ts  # skriver
 *   SET=mep …        # bara ett set
 *
 * Efter en skarp körning: `scripts/build-art-fingerprints.ts` — bilden utan
 * avtryck gör inte kortet synligt för skannerns bildmatchning.
 */
import "dotenv/config";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import {
  ctBlueprints,
  ctExpansions,
  ctNumberKey,
  matchExpansion,
  type CtBlueprint,
  type CtExpansion,
} from "../src/lib/cardtrader";
import { TCGDEX_BASE, TcgdexUnavailable, tcgdexJson } from "../src/lib/tcgdex";

function fromDotEnv(key: string): string | undefined {
  try {
    const raw = fs.readFileSync(".env", "utf8");
    return new RegExp(`^${key}\\s*=\\s*["']?([^"'\\r\\n]+)`, "m").exec(raw)?.[1];
  } catch {
    return undefined;
  }
}

const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? fromDotEnv("CARDMARKET_RAPIDAPI_KEY");
const HOST =
  process.env.CARDMARKET_RAPIDAPI_HOST ??
  fromDotEnv("CARDMARKET_RAPIDAPI_HOST") ??
  "cardmarket-api-tcg.p.rapidapi.com";
if (!process.env.DATABASE_URL) {
  const url = fromDotEnv("NEON_DATABASE_URL");
  if (url) process.env.DATABASE_URL = url;
}

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";
const ONLY_SET = process.env.SET || null;
const DEBUG = process.env.DEBUG === "1";
/**
 * Fil med kort-id att granska (JSON-lista med `{id}`), t.ex. utfallet från en
 * full bildskanning. Utan den avgör frågan nedan vilka kort som är misstänkta —
 * men en bild kan vara för LITEN utan att synas i SQL, och då är listan enda
 * vägen in.
 */
const IDS_FILE = process.env.IDS_FILE || null;

/** TCGdex-set där namnmatchningen inte räcker. Vår externalId → deras set-id. */
const SET_OVERRIDES: Record<string, string> = {
  base1: "base1",
  hgss2: "hgss2",
  hgss3: "hgss3",
  hgss4: "hgss4",
  svp: "svp",
  sve: "sve",
  fut20: "fut20",
};

const IMAGE_SUFFIXES = ["/high.webp", "/high.png", "/low.webp", "/low.png"] as const;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** TCGGO svarar 429 långt före kvottaket — seriellt med paus, aldrig parallellt. */
const TCGGO_GAP_MS = 350;

/**
 * "MEP 023" → "23" · "023/93" → "23" · "HGSS18" → "hgss18".
 *
 * ⛔ SETKODEN MÅSTE BORT NÄR DEN STÅR SOM EGET ORD. Vår katalog skriver Litten
 * som "044" medan TCGGO skriver "MEP 044" — utan strippningen blev nycklarna "44"
 * och "mep044", reservmatchningen (nummer + namn) föll, och kortet fastnade på en
 * 420 px CardTrader-bild fast TCGGO hade 736 px. Bara ren bokstavsprefix + MELLANSLAG
 * + rent tal strippas, så "HGSS18" och "TG07" (utan mellanslag) rörs inte — de är
 * äkta delserienummer, inte setkoder.
 */
function stripSetCode(s: string): string {
  return s.trim().match(/^[A-Za-z]+\s+(\d+)$/)?.[1] ?? s;
}

function numKey(s: string): string {
  const t = stripSetCode(s).toLowerCase().replace(/\s+/g, "").split("/")[0];
  const stripped = t.replace(/^0+/, "");
  return /^\d+$/.test(stripped || "0") ? String(Number(t || "0")) : stripped;
}

/**
 * Absolut, kanonisk CardTrader-URL. Deras `image_url` saknar ibland protokoll och
 * pekar på den bara värden `cardtrader.com`, som 301:ar till `www.` — en <img> som
 * kostar en extra round-trip per visning för ingenting.
 */
function absolute(url: string): string {
  let u = url;
  if (u.startsWith("//")) u = `https:${u}`;
  else if (!/^https?:\/\//.test(u)) u = `https://www.cardtrader.com${u.startsWith("/") ? "" : "/"}${u}`;
  return u.replace(/^https?:\/\/cardtrader\.com/, "https://www.cardtrader.com");
}

/**
 * CardTraders `image_url` pekar på MINIATYREN. MÄTT 2026-08-03 på Mega Charizard X
 * ex (blueprint 356943): `preview_…` = 15 kB, `show_…` = 73 kB, och samma filnamn
 * UTAN prefix = 120 kB. Miniatyren duger till ett sökresultat men inte till en
 * produktsida — och inte till strukturavtrycket, som lever på finstruktur.
 * Varianterna provas i fallande storlek; alla verifieras som vanligt.
 */
/**
 * TCGplayers bild-URL:er, i fallande kvalitet.
 *
 * ⛔ `tcgplayer-cdn/product/{id}_in_1000x1000.jpg` LJUGER I NAMNET. Trots "1000x1000"
 * svarar den med vad den råkar ha — MÄTT över våra 48 kort: 200–721 px, median 215.
 * `product-images.tcgplayer.com/fit-in/874x874/{id}.jpg` skalar i stället in till
 * en garanterad låda och gav **611–638 px, rätt proportion, 48 av 48 godkända**.
 * Den bara `{id}.jpg` är ibland ännu större (1106 px) men ojämn (samma mätning gav
 * 351 px för Growlithe), så den ligger sist.
 */
function tcgplayerCandidates(pid: number | string): { url: string; src: string }[] {
  return [
    { url: `https://product-images.tcgplayer.com/fit-in/874x874/${pid}.jpg`, src: "TCGplayer" },
    { url: `https://product-images.tcgplayer.com/${pid}.jpg`, src: "TCGplayer" },
    { url: `https://tcgplayer-cdn.tcgplayer.com/product/${pid}_in_1000x1000.jpg`, src: "TCGplayer" },
  ];
}

function isCtMiniature(url: string | null | undefined): boolean {
  return /cardtrader\.com\/uploads\/.*\/(preview|show)_/.test(url ?? "");
}

function ctImageVariants(url: string): string[] {
  const abs = absolute(url);
  const m = abs.match(/^(.*\/)(preview_|show_)(.+)$/);
  if (!m) return [abs];
  return [`${m[1]}${m[3]}`, `${m[1]}show_${m[3]}`, abs];
}

/**
 * ⛔ "LADDAR" ÄR INTE "DUGER". Den gamla kontrollen var 200 + `image/`-content-type,
 * och den godkände 48 McDonald's-kort vars bilder är **200–351 px breda** (median
 * 215). De syns som suddiga frimärken i katalogen och bär knappt någon finstruktur
 * åt skannerns strukturavtryck. Kortbilder i katalogen är 600–734 px; allt långt
 * under det är en trasig bild som råkar svara 200.
 */
const MIN_IMAGE_WIDTH = 560;
/** Kortproportion (bredd/höjd) är ~0,717. Utanför bandet = ram, utfyllnad, fel vara. */
const RATIO_MIN = 0.68;
const RATIO_MAX = 0.76;

/**
 * ⛔ EN GILTIG BILD KAN VARA FEL BILD. Scrydex CDN svarar **200 med en riktig PNG**
 * för McDonald's-korten — men det är KORTETS BAKSIDA, samma fil för varje kort
 * (identisk md5 för mcd18-1 och mcd15-6, mätt 2026-08-04). En källa som failar så
 * här hade fyllt katalogen med baksidor utan att en enda kontroll klagat.
 * Vi minns därför varje sedd bild-hash: dyker samma byte-för-byte-identiska bild
 * upp för ett ANNAT kort är det en platshållare, inte en bild.
 */
const seenHashes = new Map<string, string>(); // md5 → första kort-id

/**
 * Bildens IDENTITET, oberoende av storleksvariant.
 *
 * ⛔ HASH RÄCKER INTE. CardTraders `…/image/388969/x.png` och
 * `…/image/388969/show_x.png` är samma BILD i två storlekar — olika bytes, alltså
 * olika md5. Byte-vakten släppte därför igenom den andra Mega Greninja-raden med
 * en nedskalad kopia av den första kortets bild. Två katalograder såg fortfarande
 * identiska ut. Identiteten är källans egen post-id, inte filen.
 */
function imageIdentity(url: string): string {
  return (
    url.match(/cardtrader\.com\/uploads\/blueprints\/image\/(\d+)\//)?.[1
    ] ? `ct:${url.match(/image\/(\d+)\//)![1]}` :
    url.match(/tcggo\.com\/tcggo\/storage\/(\d+)\//) ? `tcggo:${url.match(/storage\/(\d+)\//)![1]}` :
    url.match(/tcgplayer\.com\/(?:.*\/)?(\d+)[_.]/) ? `tcgp:${url.match(/(\d+)[_.]/)![1]}` :
    url.match(/scrydex\.com\/pokemon\/([^/]+)\//) ? `scry:${url.match(/pokemon\/([^/]+)\//)![1]}` :
    url
  );
}

/** Identitet → första kort som tog den. */
const seenIdentities = new Map<string, string>();

/**
 * Hämtar bilden och gör anspråk på dess hash för kortet. `false` = hashen ägs
 * redan av ett ANNAT kort, dvs bilden skulle bli delad.
 */
async function claimHash(url: string, cardId: string): Promise<boolean> {
  const ident = imageIdentity(url);
  const identOwner = seenIdentities.get(ident);
  if (identOwner && identOwner !== cardId) return false;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return false;
    const md5 = createHash("md5").update(Buffer.from(await r.arrayBuffer())).digest("hex");
    const owner = seenHashes.get(md5);
    if (owner && owner !== cardId) return false;
    seenHashes.set(md5, cardId);
    seenIdentities.set(ident, cardId);
    return true;
  } catch {
    return false;
  }
}

interface ImageCheck {
  ok: boolean;
  width?: number;
  why?: string;
}

async function checkImage(
  url: string | null | undefined,
  cardId: string
): Promise<ImageCheck> {
  if (!url || !/^https?:\/\//.test(url)) return { ok: false, why: "ingen url" };
  const identOwner = seenIdentities.get(imageIdentity(url));
  if (identOwner && identOwner !== cardId) return { ok: false, why: `bilden tillhör ${identOwner}` };
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return { ok: false, why: `HTTP ${r.status}` };
    if (!(r.headers.get("content-type") ?? "").startsWith("image/"))
      return { ok: false, why: "inte en bild" };
    const buf = Buffer.from(await r.arrayBuffer());
    const md5 = createHash("md5").update(buf).digest("hex");
    const owner = seenHashes.get(md5);
    if (owner && owner !== cardId) return { ok: false, why: `platshållare (samma bild som ${owner})` };
    const m = await sharp(buf).metadata();
    if (!m.width || !m.height) return { ok: false, why: "gick inte att avkoda" };
    const ratio = m.width / m.height;
    if (m.width < MIN_IMAGE_WIDTH) return { ok: false, width: m.width, why: `bara ${m.width} px bred` };
    if (ratio < RATIO_MIN || ratio > RATIO_MAX)
      return { ok: false, width: m.width, why: `proportion ${ratio.toFixed(3)} (utfyllnad?)` };
    seenHashes.set(md5, cardId);
    seenIdentities.set(imageIdentity(url), cardId);
    return { ok: true, width: m.width };
  } catch (e) {
    return { ok: false, why: (e as Error).message.slice(0, 40) };
  }
}

interface TcggoCard {
  name?: string;
  image?: string;
  image_url?: string;
  card_number?: string;
  number?: string;
  cardmarket_id?: number | null;
}

async function tcggo<T>(path: string): Promise<T | null> {
  if (!KEY) return null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`https://${HOST}${path}`, {
        headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY },
        signal: AbortSignal.timeout(30_000),
      });
      await sleep(TCGGO_GAP_MS);
      if (r.status === 429 || r.status >= 500) {
        console.log(`    (TCGGO ${r.status} — backar av)`);
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!r.ok) return null;
      return (await r.json()) as T;
    } catch {
      await sleep(1500);
    }
  }
  return null;
}

/** Episodlistan hos TCGGO, ett anrop, cachad. */
let episodesCache: { id: number; name: string }[] | null = null;
async function tcggoEpisodes(): Promise<{ id: number; name: string }[]> {
  if (episodesCache) return episodesCache;
  const out: { id: number; name: string }[] = [];
  let page = 1;
  let total = 1;
  do {
    const d = await tcggo<{ data: { id: number; name: string }[]; paging: { total: number } }>(
      `/pokemon/episodes?page=${page}`
    );
    if (!d) break;
    total = d.paging?.total ?? 1;
    out.push(...d.data);
  } while (page++ < total);
  episodesCache = out;
  return out;
}

/** Alla kort i en TCGGO-episod. `paging.total` är facit — `cards_total` LJUGER. */
const episodeCards = new Map<number, TcggoCard[]>();
async function tcggoEpisodeCards(episodeId: number): Promise<TcggoCard[]> {
  const hit = episodeCards.get(episodeId);
  if (hit) return hit;
  const out: TcggoCard[] = [];
  let page = 1;
  let total = 1;
  do {
    const d = await tcggo<{ data: TcggoCard[]; paging: { total: number } }>(
      `/pokemon/episodes/${episodeId}/cards?page=${page}`
    );
    if (!d) break;
    total = d.paging?.total ?? 1;
    out.push(...d.data);
  } while (page++ < total);
  episodeCards.set(episodeId, out);
  return out;
}

const ctBlueprintCache = new Map<number, CtBlueprint[]>();
let ctExpansionList: CtExpansion[] | null = null;

async function main() {
  if (!KEY) console.warn("⚠️ Ingen RapidAPI-nyckel — TCGGO-vägen hoppas över.");

  // Kandidater = kort som PLAUSIBELT är trasiga. Ett kort med fungerande bild
  // rörs aldrig; det enda som händer med ett sådant är att det räknas som OK.
  //  · artFingerprint = null → bilden gick inte att läsa när avtrycken byggdes
  //  · imageUrl = null      → ingen bild alls
  //  · tcggo-värd           → rotationsbenägen, verifieras varje körning
  const onlyIds: string[] | null = IDS_FILE
    ? (JSON.parse(fs.readFileSync(IDS_FILE, "utf8")) as { id: string }[]).map((x) => x.id)
    : null;

  const targets = await prisma.card.findMany({
    where: {
      ...(ONLY_SET ? { set: { externalId: ONLY_SET } } : {}),
      // ⛔ EN ID-LISTA ERSÄTTER HEURISTIKEN, den filtrerar den inte. Listan kommer
      // från en MÄTNING (full bildskanning) och vet därför saker SQL inte kan se —
      // t.ex. att en bild är 400 px. AND:ade man ihop dem föll varje kort som har
      // avtryck och en pokemontcg.io-URL bort, dvs precis de 301 som skulle lagas.
      ...(onlyIds
        ? { id: { in: onlyIds } }
        : {
            OR: [
              { artFingerprint: null },
              { imageUrl: null },
              { imageUrl: { contains: "tcggo" } },
              { imageUrl: { contains: "cardtrader" } },
        // TCGplayer-URL:er är misstänkta tills de mätts: `_in_1000x1000` svarar
        // ofta med 200–351 px. Kvalitetskontrollen avgör, inte värdnamnet.
              { imageUrl: { contains: "tcgplayer" } },
            ],
          }),
    },
    select: {
      id: true,
      name: true,
      number: true,
      imageUrl: true,
      tcgExternalId: true,
      cardmarketId: true,
      set: { select: { id: true, name: true, series: true, externalId: true } },
      products: { select: { id: true, slug: true, imageUrl: true } },
    },
    orderBy: [{ setId: "asc" }, { numberSortKey: "asc" }],
  });
  console.log(`Kandidater: ${targets.length}${ONLY_SET ? ` (set=${ONLY_SET})` : ""}\n`);

  // TCGdex är källa 3 av 4 — går den inte att nå (2026-08-30: ETIMEDOUT från
  // runnern) ska pokemontcg.io/TCGGO/CardTrader ändå få laga det de kan, inte
  // hela steget dö på första anropet. Tom karta ⇒ TCGdex-vägen hoppas över.
  let dexSets: { id: string; name: string }[] = [];
  try {
    dexSets = (await tcgdexJson<{ id: string; name: string }[]>(`${TCGDEX_BASE}/en/sets`)) ?? [];
  } catch (e) {
    if (!(e instanceof TcgdexUnavailable)) throw e;
    console.warn(`TCGdex otillgänglig — hoppar över den källan: ${e.message}`);
  }
  const dexByName = new Map(dexSets.map((s) => [norm(s.name), s.id]));

  let alreadyOk = 0;
  let fixed = 0;
  let unresolved = 0;
  let productsFixed = 0;
  const bySource = new Map<string, number>();

  for (const c of targets) {
    const label = `${c.set.externalId ?? c.set.name} #${c.number} ${c.name}`;

    // 0. Fungerar den lagrade bilden redan? Rör den då inte. Undantag: en
    // CardTrader-MINIATYR fungerar men duger inte — den ska uppgraderas.
    const storedCheck = isCtMiniature(c.imageUrl)
      ? { ok: false, why: "miniatyr" }
      : await checkImage(c.imageUrl, c.id);
    const stored = storedCheck.ok;
    let url: string | null = stored ? c.imageUrl! : null;
    let src = "(oförändrad)";

    if (!stored) {
      const candidates: { url: string; src: string }[] = [];

      // --- Källa 1: TCGGO ---
      if (c.tcgExternalId) {
        const d = await tcggo<{ data: TcggoCard[] }>(
          `/pokemon/cards?tcgid=${encodeURIComponent(c.tcgExternalId)}`
        );
        const img = d?.data?.[0]?.image ?? d?.data?.[0]?.image_url;
        if (img) candidates.push({ url: img, src: "TCGGO" });
      } else if (KEY) {
        // Inget tcgid → hitta setets episod och joina på cardmarket_id.
        const eps = await tcggoEpisodes();
        const ep = eps.find((e) => norm(e.name) === norm(c.set.name));
        if (ep) {
          const rows = await tcggoEpisodeCards(ep.id);
          const want = numKey(c.number);
          const hit =
            (c.cardmarketId != null
              ? rows.find((r) => r.cardmarket_id === c.cardmarketId)
              : undefined) ??
            rows.find((r) => {
              const n = r.card_number ?? r.number;
              return n != null && numKey(String(n)) === want && norm(r.name ?? "") === norm(c.name);
            });
          const img = hit?.image ?? hit?.image_url;
          if (img) candidates.push({ url: img, src: "TCGGO" });
        }
      }

      // --- Källa 2: CardTrader (gratis) ---
      if (process.env.CARDTRADER_TOKEN) {
        try {
          ctExpansionList ??= await ctExpansions();
          const exp = matchExpansion(c.set.name, c.set.series, ctExpansionList);
          if (exp) {
            let bps = ctBlueprintCache.get(exp.id);
            if (!bps) {
              bps = await ctBlueprints(exp.id);
              ctBlueprintCache.set(exp.id, bps);
              await sleep(400);
            }
            // Samma setkods-fälla som numKey: vår "MEP 081" mot CardTraders "081".
            const want = ctNumberKey(stripSetCode(c.number));
            const hit = bps.find(
              (b) =>
                ctNumberKey(b.fixed_properties?.collector_number) === want &&
                norm(b.name) === norm(c.name)
            );
            if (hit?.image_url)
              for (const v of ctImageVariants(hit.image_url))
                candidates.push({ url: v, src: "CardTrader" });
          }
        } catch (e) {
          console.log(`    (CardTrader: ${(e as Error).message.slice(0, 80)})`);
        }
      }

      // --- Källa: Scrydex (äger numera pokemontcg.io) ---
      // ⛔ MÅSTE gå genom hash-vakten: Scrydex svarar 200 med KORTETS BAKSIDA för
      // set de saknar (identisk md5 för mcd18-1 och mcd15-6). För set de HAR är
      // bilden äkta och bra — svp-102 Oddish: 598x836, unik hash. Den enda källan
      // som räddar de pokemontcg.io-kort som 404:at.
      if (c.tcgExternalId)
        candidates.push({
          url: `https://images.scrydex.com/pokemon/${c.tcgExternalId}/large`,
          src: "Scrydex",
        });

      // Har kortet redan en TCGplayer-bild kan productId:t återanvändas direkt —
      // ingen TCGdex-slagning behövs för att hitta en BÄTTRE variant av samma bild.
      const ownPid = c.imageUrl?.match(/(?:product\/|tcgplayer\.com\/)(\d+)[_.]/)?.[1];
      if (ownPid) candidates.push(...tcgplayerCandidates(ownPid));

      // --- Källa 3 + 4: TCGdex och TCGplayers CDN ---
      // ⛔ PROVA KORTETS EGET tcgid FÖRST. I EX-eran ÄR vårt `tcgExternalId`
      // TCGdex-id (ex4-53 svarar direkt), och där ligger vinsten: pokemontcg.io:s
      // "_hires" är bara 400x550 för ex1/ex2/ex4 medan TCGdex har 600x825.
      // Namnvägen nedan behövs ändå för set där id-scheman skiljer sig.
      const dexIds = [c.tcgExternalId, null].filter(Boolean) as string[];
      const dexSet = SET_OVERRIDES[c.set.externalId ?? ""] ?? dexByName.get(norm(c.set.name));
      if (dexSet) dexIds.push(`${dexSet}-${c.number}`);
      for (const dexId of dexIds) {
        const card = await tcgdexJson<{ image?: string }>(`${TCGDEX_BASE}/en/cards/${dexId}`, {
          retries: 1,
        }).catch(() => null);
        if (!card?.image) continue;
        for (const suf of IMAGE_SUFFIXES) candidates.push({ url: `${card.image}${suf}`, src: "TCGdex" });
        break;
      }
      if (dexSet) {
        const card = await tcgdexJson<{
          image?: string;
          pricing?: { tcgplayer?: Record<string, { productId?: number } | undefined> };
        }>(`${TCGDEX_BASE}/en/cards/${dexSet}-${c.number}`, { retries: 1 }).catch(() => null);
        if (card) {
          if (card.image)
            for (const s of IMAGE_SUFFIXES) candidates.push({ url: `${card.image}${s}`, src: "TCGdex" });
          const pid = Object.values(card.pricing?.tcgplayer ?? {}).find((v) => v?.productId)
            ?.productId;
          if (pid) candidates.push(...tcgplayerCandidates(pid));
        }
      }

      /**
       * ⛔ TRÖSKELN ÄR ETT MÅL, INTE ETT ULTIMATUM. Mega Greninja ex · MEP 081
       * finns hos TCGGO i 255 px och hos CardTrader i 476 px — ingen når 560, men
       * 476 är nästan dubbelt så bra som det vi har. Att avstå hade bevarat den
       * SÄMSTA bilden av principskäl. Reserven tar därför den BREDASTE kandidat
       * som bara föll på bredden (aldrig på proportion eller platshållar-vakten)
       * och som dessutom är bredare än den vi redan har.
       */
      const tooNarrow: { url: string; src: string; width: number }[] = [];
      for (const cand of candidates) {
        const chk = await checkImage(cand.url, c.id);
        if (chk.ok) {
          url = cand.url;
          src = cand.src;
          break;
        }
        if (chk.width && /px bred$/.test(chk.why ?? ""))
          tooNarrow.push({ url: cand.url, src: cand.src, width: chk.width });
        if (DEBUG) console.log(`      · [${cand.src}] ${chk.why} — ${cand.url.slice(0, 80)}`);
      }
      if (!url && tooNarrow.length) {
        const best = tooNarrow.reduce((a, b) => (b.width > a.width ? b : a));
        // ⛔ RESERVEN FÅR INTE SLÅ IHOP TVÅ KATALOGRADER. MEP 081 Mega Greninja ex
        // finns som TVÅ kort (cmid 885516/885517) med var sin EGEN 255 px-bild hos
        // TCGGO, men CardTrader har bara EN blueprint. Utan den här vakten hade
        // båda fått samma bild — visuellt omöjliga att skilja åt, och två identiska
        // avtryck som konkurrerar i skannern. Hellre en smal men EGEN bild.
        const claimed = await claimHash(best.url, c.id);
        if (claimed && best.width > (storedCheck.width ?? 0)) {
          url = best.url;
          src = `${best.src} (${best.width} px — bäst tillgängliga)`;
        } else if (DEBUG && !claimed) {
          console.log("      · reserven hoppades över: bilden tillhör redan ett annat kort");
        }
      }
      if (DEBUG && candidates.length === 0) console.log("      · inga kandidater alls");
    }

    if (!url) {
      unresolved++;
      console.log(`  [SAKNAS]  ${label}`);
      continue;
    }

    if (url !== c.imageUrl) {
      bySource.set(src, (bySource.get(src) ?? 0) + 1);
      console.log(`  [${src}] ${label}\n      ${url}`);
      if (APPLY) await prisma.card.update({ where: { id: c.id }, data: { imageUrl: url } });
      fixed++;
    } else {
      alreadyOk++;
    }

    // Produkterna: katalogsidan läser Product.imageUrl, inte kortets.
    for (const p of c.products) {
      if (p.imageUrl === url) continue;
      // En produkt med EGEN fungerande bild rörs inte — den kan vara ett
      // butiksfoto som medvetet valts framför katalogbilden.
      if (p.imageUrl && !isCtMiniature(p.imageUrl) && (await checkImage(p.imageUrl, c.id)).ok) continue;
      console.log(`      → produkt ${p.slug}`);
      if (APPLY) await prisma.product.update({ where: { id: p.id }, data: { imageUrl: url } });
      productsFixed++;
    }
  }

  console.log(
    `\n${APPLY ? "SKREV" : "TORRKÖRNING"}: ${fixed} kort lagade · ${productsFixed} produkter · ` +
      `${alreadyOk} redan OK · ${unresolved} utan någon fungerande källa`
  );
  console.log(`  per källa: ${[...bySource].map(([k, n]) => `${k}=${n}`).join(" · ") || "(inga)"}`);
  if (fixed && APPLY) {
    console.log(
      "\n⛔ NÄSTA STEG: kör scripts/build-art-fingerprints.ts — bilderna är lagade men\n" +
        "   avtrycken byggs inte av sig själva, och det är avtrycket som gör korten\n" +
        "   synliga för skannerns bildmatchning."
    );
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
