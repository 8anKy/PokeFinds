/**
 * LÄNK-REVISION — hämtar VARJE butikslänk och jämför produkten mot vad sidan
 * FAKTISKT säljer (JSON-LD `name` > og:title > <title>).
 *
 * VARFÖR SIDAN OCH INTE SLUGEN (mätt 2026-07-14, inte gissat):
 * Skriptet läste tidigare bara URL-slugen. Kör man hela vaktbatteriet mot slugen
 * blir facit-utfallet 12 rätt / 30 FALSKLARM. Mot sidans egen titel: 12 rätt /
 * 4 falsklarm. Samma träffsäkerhet, en sjundedel av bruset. Slugen ljuger —
 * MaxGamings "…-sv4a-…" pekar på en sida som heter sv7a, och Speltrollet klistrar
 * ihop set-koden med "japansk" ("s7djapansk") så varje japansk länk såg trasig ut.
 * En revision som skriker 30 gånger i onödan blir ignorerad, och då är den värre
 * än ingen revision alls.
 *
 * VAKTERNA ÄR productsConflict() — HELA batteriet, inte ett urval.
 * Den gamla versionen körde tre av tretton (serie, språk, set-markör). Skillnaden
 * var inget beslut, den hade glidit isär: pokemonCenterMismatch() fanns, var korrekt,
 * och kördes i matchningen — men aldrig här. Sju Pokémon Center-exklusiva ETB:er låg
 * därför länkade till den vanliga butiks-ETB:n vecka efter vecka utan ett ord.
 * Lägg till nya vakter i productsConflict, aldrig här.
 *
 * Läser bara. Fixa alltid via offer-ID, aldrig via URL ([[project-wrong-link-orphan-offers]]).
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-links.ts
 * Exit 1 om säkra fel hittas → röd körning i store-health.
 */
import { PrismaClient } from "@prisma/client";
import { isDirectOfferUrl } from "../src/lib/marketplace-urls";
import { detectListingLanguage } from "../src/lib/listing-language";
import {
  cleanListingTitle,
  distinctiveOverlap,
  isAccessoryListing,
  productsConflict,
  scoreSimilarity,
  setMarkerMismatch,
} from "../src/scrapers/matching";

const prisma = new PrismaClient();

const NON_STORE = ["Cardmarket", "Tradera", "Pokémon TCG API", "TCGdex API"];
const UA = "FoilioBot/1.0 (+kontakt: hej@foilio.se)";
/** Per värd, INTE globalt: butikerna 429:ar om man skjuter parallellt mot samma domän. */
const HOST_DELAY_MS = Number(process.env.AUDIT_DELAY_MS ?? 1500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function pick(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? decodeEntities(m[1].trim()) : null;
}
/** JSON-LD Product.name — butikens egen, strukturerade produktidentitet. Bäst av alla. */
function ldName(html: string): string | null {
  for (const b of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try { data = JSON.parse(b[1].trim()); } catch { continue; }
    const stack: unknown[] = [data];
    while (stack.length) {
      const node = stack.pop() as Record<string, unknown> | null;
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) { stack.push(...node); continue; }
      if (node["@graph"]) stack.push(node["@graph"]);
      const type = node["@type"];
      if ((type === "Product" || (Array.isArray(type) && type.includes("Product"))) && typeof node.name === "string")
        return decodeEntities(node.name);
      for (const v of Object.values(node)) if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}
/** Butikens <title> bär ett säljsuffix ("… | Dragon's Lair") som inte är produktidentitet. */
const STORE_SUFFIX =
  /\s*[|–—-]\s*(Dragon'?s Lair|MaxGaming.*|Speltrollet.*|Alphaspel.*|Webhallen.*|Goblinen.*|Samlarhobby.*|Swepoke.*|Shinycards.*|Spelexperten.*|Manat[öo]rsk.*|K[öo]p .*|Handla .*)\s*$/i;

type Fetched = { name: string | null; dead: boolean; why: string };

async function fetchIdentity(url: string): Promise<Fetched> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(45_000) });
      if (res.status === 429 || res.status >= 500) { await sleep(4000 * (attempt + 1)); continue; }
      if (res.status === 404 || res.status === 410) return { name: null, dead: true, why: `HTTP ${res.status}` };
      if (!res.ok) return { name: null, dead: true, why: `HTTP ${res.status}` };
      const html = await res.text();
      const raw =
        ldName(html) ??
        pick(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
        pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
      if (!raw) return { name: null, dead: false, why: "ingen titel på sidan" };
      return { name: cleanListingTitle(raw.replace(STORE_SUFFIX, "").replace(/\s+/g, " ").trim()), dead: false, why: "" };
    } catch (e) {
      if (attempt === 2) return { name: null, dead: false, why: e instanceof Error ? e.message.slice(0, 60) : "fetch-fel" };
      await sleep(2000);
    }
  }
  return { name: null, dead: false, why: "429 efter omförsök" };
}

/**
 * Butiken buntar ibland en RIKTIG produkt med ett tillbehör ("Lost Origin, Display /
 * Booster Box + Acrylic case"). Länken är då KORREKT — sidan säljer produkten, bara med
 * ett fodral på köpet (användarbeslut 2026-07-14: de ska länkas, inte raderas). Ett
 * ensamt tillbehörs-avvikelse är därför GRANSKA, inte SÄKERT FEL. Ett fodral UTAN
 * plustecken ("Acrylic Booster Box Display FOR Pokémon") är fortfarande ett rent
 * tillbehör och fångas av att alla andra vakter fortfarande gäller.
 */
function bundleWithAccessory(pageName: string): string {
  return pageName.replace(/\s*[+&]\s*(acrylic|akryl)\w*[^,]*/i, "").trim();
}

async function main() {
  const offers = await prisma.offer.findMany({
    where: { retailer: { name: { notIn: NON_STORE } } },
    select: {
      id: true, url: true,
      retailer: { select: { name: true } },
      product: { select: { id: true, title: true, language: true } },
    },
  });
  const targets = offers.filter((o) => isDirectOfferUrl(o.url));
  console.log(`${targets.length} butiks-offers granskas (hämtar varje sida).`);

  // Sekventiellt PER VÄRD, värdarna parallellt.
  const byHost = new Map<string, typeof targets>();
  for (const o of targets) {
    const h = new URL(o.url).host;
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h)!.push(o);
  }

  const definite: { o: (typeof targets)[number]; page: string; why: string }[] = [];
  const review: { o: (typeof targets)[number]; page: string; why: string; score: number }[] = [];
  let done = 0;

  await Promise.all(
    [...byHost.values()].map(async (list) => {
      for (const o of list) {
        const { name, dead, why } = await fetchIdentity(o.url);
        await sleep(HOST_DELAY_MS);
        if (++done % 100 === 0) console.log(`  …${done}/${targets.length}`);

        if (dead) { definite.push({ o, page: "—", why: `DÖD LÄNK (${why})` }); continue; }
        if (!name) { review.push({ o, page: "—", why: why || "ingen titel", score: 0 }); continue; }

        const title = o.product.title;
        // Blockat språk på SIDAN = fel produkt oavsett titel-likhet.
        const lang = detectListingLanguage(name, o.url);
        if (lang === "CN" || lang === "KR" || lang === "EU") {
          definite.push({ o, page: name, why: `blockerat språk (${lang})` });
          continue;
        }

        // ---- Tre carve-outs. MÄTTA mot facit (1194 länkar), inte gissade: utan dem
        // ---- larmar regeln 4 gånger på VERIFIERAT KORREKTA länkar. Med dem: 9 rätt, 1 fel.
        //
        // 1. Katalogen märker japanska produkter "(Japansk)"; butikssidan gör det sällan.
        //    Utan detta skriker språkvakten på varje korrekt japansk länk (Swepokes sv4K,
        //    sv7 …). Jämställ sidorna i stället för att stänga av vakten.
        const jp = o.product.language === "JP";
        // 2. Butiken buntar en RIKTIG produkt med ett fodral ("… + Acrylic case"). Länken är
        //    korrekt — sidan säljer produkten, med ett tillbehör på köpet (användarbeslut
        //    2026-07-14: buntarna länkas, de raderas inte). BÅDA sidor rensas, annars flaggas
        //    en paket-offer mot sin egen identiska titel. Ett fodral UTAN plustecken
        //    ("Acrylic Booster Box Display FOR Pokémon") rörs inte och fångas fortfarande.
        const a = bundleWithAccessory(jp ? `${title} japansk` : title);
        const b = bundleWithAccessory(jp ? `${name} japansk` : name);

        if (productsConflict(a, b)) {
          // 3. Sidans titel är MINDRE specifik än vår — butiken utelämnar set-prefixet
          //    ("151: Blooming Waters Premium Collection" → sidan heter "Blooming Waters").
          //    Kortare formulering, inte en annan produkt. Kräver ändå rimlig likhet.
          const lessSpecific =
            (distinctiveOverlap(b, a) >= 0.999 || setMarkerMismatch(a, b)) && scoreSimilarity(a, b) >= 0.4;
          if (lessSpecific) {
            review.push({ o, page: name, why: "sidan utelämnar set-prefixet", score: scoreSimilarity(a, b) });
          } else if (isAccessoryListing(title) !== isAccessoryListing(name)) {
            review.push({ o, page: name, why: "butiken buntar med tillbehör", score: scoreSimilarity(a, b) });
          } else {
            definite.push({ o, page: name, why: "vakt motsäger länken" });
          }
          continue;
        }
        const score = scoreSimilarity(title, name);
        if (score < 0.35) review.push({ o, page: name, why: "sidan beskriver något annat", score });
      }
    })
  );

  console.log(`\n=== SÄKRA fel: ${definite.length} ===`);
  for (const d of definite) {
    console.log(`\n  ✗ [${d.why}] ${d.o.retailer.name}  offer=${d.o.id}`);
    console.log(`    katalogen: "${d.o.product.title}"`);
    console.log(`    sidan:     "${d.page}"`);
    console.log(`    ${d.o.url}`);
  }

  review.sort((a, b) => a.score - b.score);
  console.log(`\n\n=== GRANSKA: ${review.length} ===`);
  for (const r of review) {
    console.log(`  [${r.why}, sim ${r.score.toFixed(2)}] ${r.o.retailer.name} | "${r.o.product.title}"`);
    console.log(`     sidan: "${r.page}"`);
    console.log(`     ${r.o.url}`);
  }

  console.log(`\nSUMMERING: ${definite.length} säkra fel · ${review.length} att granska · ${targets.length} kontrollerade`);
  if (definite.length > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
