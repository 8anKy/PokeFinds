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
import { PrismaClient } from "@prisma/client";
import {
  ctBlueprints,
  ctExpansions,
  ctNumberKey,
  matchExpansion,
  type CtBlueprint,
  type CtExpansion,
} from "../src/lib/cardtrader";

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

/** "MEP 023" → "23" · "023/93" → "23" · "HGSS18" → "hgss18". */
function numKey(s: string): string {
  const t = s.toLowerCase().replace(/\s+/g, "").split("/")[0];
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
function isCtMiniature(url: string | null | undefined): boolean {
  return /cardtrader\.com\/uploads\/.*\/(preview|show)_/.test(url ?? "");
}

function ctImageVariants(url: string): string[] {
  const abs = absolute(url);
  const m = abs.match(/^(.*\/)(preview_|show_)(.+)$/);
  if (!m) return [abs];
  return [`${m[1]}${m[3]}`, `${m[1]}show_${m[3]}`, abs];
}

async function imageWorks(url: string | null | undefined): Promise<boolean> {
  if (!url || !/^https?:\/\//.test(url)) return false;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return false;
    return (r.headers.get("content-type") ?? "").startsWith("image/");
  } catch {
    return false;
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
  const targets = await prisma.card.findMany({
    where: {
      ...(ONLY_SET ? { set: { externalId: ONLY_SET } } : {}),
      OR: [
        { artFingerprint: null },
        { imageUrl: null },
        { imageUrl: { contains: "tcggo" } },
        { imageUrl: { contains: "cardtrader" } },
      ],
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

  const dexSets = (await (await fetch("https://api.tcgdex.net/v2/en/sets")).json()) as {
    id: string;
    name: string;
  }[];
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
    const stored = !isCtMiniature(c.imageUrl) && (await imageWorks(c.imageUrl));
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
            const want = ctNumberKey(c.number);
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

      // --- Källa 3 + 4: TCGdex och TCGplayers CDN ---
      const dexSet = SET_OVERRIDES[c.set.externalId ?? ""] ?? dexByName.get(norm(c.set.name));
      if (dexSet) {
        const r = await fetch(`https://api.tcgdex.net/v2/en/cards/${dexSet}-${c.number}`).catch(
          () => null
        );
        if (r?.ok) {
          const card = (await r.json()) as {
            image?: string;
            pricing?: { tcgplayer?: Record<string, { productId?: number } | undefined> };
          };
          if (card.image)
            for (const s of IMAGE_SUFFIXES) candidates.push({ url: `${card.image}${s}`, src: "TCGdex" });
          const pid = Object.values(card.pricing?.tcgplayer ?? {}).find((v) => v?.productId)
            ?.productId;
          if (pid)
            candidates.push({
              url: `https://tcgplayer-cdn.tcgplayer.com/product/${pid}_in_1000x1000.jpg`,
              src: "TCGplayer",
            });
        }
      }

      for (const cand of candidates) {
        if (await imageWorks(cand.url)) {
          url = cand.url;
          src = cand.src;
          break;
        }
      }
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
      if (p.imageUrl && !isCtMiniature(p.imageUrl) && (await imageWorks(p.imageUrl))) continue;
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
