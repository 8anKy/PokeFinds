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

// CardTrader hör hit sedan 2026-08-10: variantbygget (08-03) skapade ~26 400 singel-
// offers med CardTrader-länkar, och utan undantaget växte revisionen 2 900 → 29 300
// sidhämtningar (~20 h) — det var DET som fick store-health att timeouta vecka efter
// vecka, inte butikslänkarna. CardTrader-länkarna byggs dessutom ur deras EGET API med
// dubbla namnvakter (blueprint-namn + CM-katalog) — en sidhämtning reviderar inget som
// inte redan är maskinverifierat.
const NON_STORE = ["Cardmarket", "Tradera", "CardTrader", "Pokémon TCG API", "TCGdex API"];
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
/**
 * JSON-LD Product.name — butikens egen, strukturerade produktidentitet. Bäst av alla.
 *
 * MEN: en SORTIMENTSSIDA har ETT Product-block PER VARIANT (Speltrollets ex-box-sida
 * listar Mega Emboar, Mega Meganium OCH Mega Feraligatr). Den gamla versionen tog det
 * block som råkade poppas först ur stacken — ett myntkast — och jämförde vår Mega
 * Emboar-produkt mot ett slumpvalt syskon. Det var hela "sidan säljer Mega Feraligatr"-
 * larmet: sidan säljer alla tre. Flera OLIKA namn → sidan har ingen entydig identitet
 * här; returnera inget och låt og:title (produkttiteln utan variant) svara i stället.
 * Samma regel som productNameFromHtml() i gtin-source.ts.
 */
function ldName(html: string): string | null {
  const names = new Set<string>();
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
        names.add(decodeEntities(node.name));
      for (const v of Object.values(node)) if (v && typeof v === "object") stack.push(v);
    }
  }
  return names.size === 1 ? [...names][0] : null;
}

/**
 * En `?variant=`-länk pekar på EN SKU på en sortimentssida — men sidans HTML ser likadan
 * ut för alla tre varianterna (og:title bär bara produktnamnet, JSON-LD listar allihop).
 * Sidhämtningen kan alltså inte avgöra vilken box länken går till. Butikens egen
 * variant-JSON kan: den ger variantens namn, och det är den identitet vi vill revidera
 * mot ("Pokemon Ascended Heroes ex Box - Mega Meganium").
 */
async function shopifyVariantName(url: string): Promise<string | null> {
  const id = url.match(/[?&]variant=(\d+)/);
  const handle = url.match(/\/products\/([^/?#]+)/);
  if (!id || !handle) return null;
  try {
    const res = await fetch(`${new URL(url).origin}/products/${handle[1]}.js`, {
      headers: { "user-agent": UA, cookie: "localization=SE" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string; variants?: { id: number; title?: string }[] };
    const v = (data.variants ?? []).find((x) => x.id === Number(id[1]));
    if (!data.title || !v?.title) return null;
    return `${data.title.trim()} - ${v.title.trim()}`;
  } catch {
    return null; // inte Shopify, eller nere → fall tillbaka på sidhämtningen
  }
}
/** Butikens <title> bär ett säljsuffix ("… | Dragon's Lair") som inte är produktidentitet. */
const STORE_SUFFIX =
  /\s*[|–—-]\s*(Dragon'?s Lair|MaxGaming.*|Speltrollet.*|Alphaspel.*|Webhallen.*|Goblinen.*|Samlarhobby.*|Swepoke.*|Shinycards.*|Spelexperten.*|Manat[öo]rsk.*|K[öo]p .*|Handla .*)\s*$/i;

type Fetched = { name: string | null; dead: boolean; refused: boolean; why: string };

/**
 * ⛔ "BUTIKEN VÄGRADE SVARA" ÄR INTE "LÄNKEN ÄR DÖD". Samma skillnad som
 * `check-store-health.ts` gör på 0 produkter: en 404/410 betyder att sidan är BORTA
 * (länken ska bort), medan 401/403/407/451 betyder att butikens brandvägg/WAF sa nej
 * till OSS — sidan kan vara kerngfrisk för en riktig besökare.
 *
 * MÄTT 2026-08-25: alla nio Leksaksaffären-länkar som veckorapporten listade under
 * "SÄKRA fel" svarar **HTTP 200** från en vanlig IP, med vår egen FoilioBot-UA. De var
 * 403 enbart för att GitHub Actions egress-IP är blockerad hos butiken. De låg alltså i
 * exakt den hög en människa bulk-rensar — och en rensning hade tagit bort nio fullt
 * fungerande köplänkar och strippat Leksaksaffären från nio produktsidor.
 *
 * 429 hamnar INTE här: den har redan gjort tre omförsök ovan och betyder "för fort",
 * inte "nej till dig".
 */
const REFUSAL_CODES = new Set([401, 403, 407, 451]);

async function fetchIdentity(url: string): Promise<Fetched> {
  // Variantlänk: bara butikens variant-JSON vet vilken SKU länken pekar på (se ovan).
  const variantName = await shopifyVariantName(url);
  if (variantName) return { name: cleanListingTitle(variantName), dead: false, refused: false, why: "" };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(45_000) });
      if (res.status === 429 || res.status >= 500) { await sleep(4000 * (attempt + 1)); continue; }
      if (REFUSAL_CODES.has(res.status)) return { name: null, dead: false, refused: true, why: `HTTP ${res.status}` };
      if (res.status === 404 || res.status === 410) return { name: null, dead: true, refused: false, why: `HTTP ${res.status}` };
      if (!res.ok) return { name: null, dead: true, refused: false, why: `HTTP ${res.status}` };
      const html = await res.text();
      const raw =
        ldName(html) ??
        pick(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
        pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
      if (!raw) return { name: null, dead: false, refused: false, why: "ingen titel på sidan" };
      return { name: cleanListingTitle(raw.replace(STORE_SUFFIX, "").replace(/\s+/g, " ").trim()), dead: false, refused: false, why: "" };
    } catch (e) {
      if (attempt === 2) return { name: null, dead: false, refused: false, why: e instanceof Error ? e.message.slice(0, 60) : "fetch-fel" };
      await sleep(2000);
    }
  }
  return { name: null, dead: false, refused: false, why: "429 efter omförsök" };
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
  // Butiken sa nej till OSS — varken säkert fel eller något en människa kan granska
  // på titeln (vi får ingen titel). Egen hink, aldrig röd. Se REFUSAL_CODES.
  const refusedByStore: { o: (typeof targets)[number]; why: string }[] = [];
  let done = 0;

  await Promise.all(
    [...byHost.values()].map(async (list) => {
      for (const o of list) {
        const { name, dead, refused, why } = await fetchIdentity(o.url);
        await sleep(HOST_DELAY_MS);
        if (++done % 100 === 0) console.log(`  …${done}/${targets.length}`);

        if (refused) { refusedByStore.push({ o, why }); continue; }
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

  // Egen rubrik, UNDER granska-listan: de här länkarna är inte trasiga, och det finns
  // inget att granska på titeln — vi fick ingen. Rapporten finns för att bortfallet ska
  // vara SYNLIGT (butiken spärrar vår IP ⇒ revisionen täcker dem inte alls), inte för
  // att någon ska agera på dem länk för länk. Summerat per butik: det är butiken som är
  // enheten här, aldrig den enskilda länken.
  if (refusedByStore.length > 0) {
    const perStore = new Map<string, { n: number; why: string }>();
    for (const r of refusedByStore) {
      const cur = perStore.get(r.o.retailer.name);
      if (cur) cur.n++;
      else perStore.set(r.o.retailer.name, { n: 1, why: r.why });
    }
    console.log(`\n\n=== BUTIKEN AVVISADE OSS — EJ REVIDERADE: ${refusedByStore.length} ===`);
    console.log("   (INTE döda länkar. Butikens brandvägg sa nej till vår IP/UA — sidorna kan");
    console.log("    vara helt friska för en vanlig besökare. Ta ALDRIG bort dem på den grunden;");
    console.log("    verifiera först från en annan IP.)");
    for (const [store, v] of [...perStore.entries()].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`   • ${store}: ${v.n} länkar (${v.why})`);
    }
  }

  console.log(
    `\nSUMMERING: ${definite.length} säkra fel · ${review.length} att granska · ` +
      `${refusedByStore.length} avvisade av butiken · ${targets.length} kontrollerade`
  );
  // ⛔ `refusedByStore` gör ALDRIG körningen röd. Att en butik spärrar Actions-IP:n går
  // inte att laga i koden, och en rapport som är permanent röd slutar bli läst.
  if (definite.length > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
