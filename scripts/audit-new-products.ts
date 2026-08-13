/**
 * REVISION AV NYINKOMNA KATALOGPRODUKTER (rapport — skriver ALDRIG till DB).
 *
 * Bakgrund: wave 5 + täckningsrevisionen 2026-08-13 lät auto-importen skapa ~900 nya
 * katalogprodukter på en natt. Det är den största enskilda tillväxten sedan
 * sealed-importen, och vakterna (`ensureListingProduct`) är byggda för ett par nya
 * SKU:er per dygn — inte för ett helt nytt sortiment från åtta okända butiker.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-new-products.ts --since 2026-08-13
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-new-products.ts --since 2026-08-13 --judge
 *   npx tsx scripts/audit-new-products.ts --reuse --judge          # ingen DB alls
 *
 * Flaggor:
 *   --since YYYY-MM-DD   kohorten = produkter skapade fr.o.m. detta datum (UTC)
 *   --out <fil>          skriv rapporten till fil i stället för stdout
 *   --cache <fil>        JSON-cache av DB-läsningen (default i scratchpad/ bredvid)
 *   --reuse              läs cachen i stället för DB (Neon förblir sovande)
 *   --judge              kör LLM-domarna (kräver ANTHROPIC_API_KEY)
 *   --judge-limit N      tak för antal dubblettpar som skickas till domaren
 *
 * TEKNIKER (alla oberoende — en produkt kan träffas av flera):
 *   1. SPRÅK      — isBlockedListingLanguage på titel + slug + varje butiks-URL
 *   2. FRÄMLING   — tillbehör / annan franchise / merch / singel / butiksbundle
 *   3. INGEN SIGNAL — hasPokemonTitleSignal säger nej (den POSITIVA vakten)
 *   4. KARAKTÄRSLÖS — blister/mini tin utan karaktär (största dubblettklassen)
 *   5. GTIN       — samma tillverkarstreckkod som en annan produkt = bevisad dubblett
 *   6. TVILLING   — bästa titellikhet mot HELA sealed-katalogen (ny vs gammal + ny vs ny)
 *   7. SAMMA SET  — nära identiska titlar i samma set + kategori
 *
 * LLM-DOMARE (två, olika frågor — blanda dem aldrig):
 *   A. KLASSIFICERING av VARJE ny produkt: är det en Pokémon TCG-vara, vilken form,
 *      vilket språk? Batchad (BATCH titlar per anrop). Poängen är att en blocklista
 *      aldrig blir komplett — domaren ser franchiser och språk regexen inte känner.
 *   B. DUBBLETT: judgeSameProduct (samma domare som auto-importens gränsfall) på
 *      varje kandidatpar från teknik 5–7.
 */
// ⛔ FÖRST: with-prod-db.mjs skickar bara DATABASE_URL, så ANTHROPIC_API_KEY är osatt
//    utan det här. Utan nyckel returnerar judgeSameProduct null — omöjligt att skilja
//    från "olika produkter" — och rapporten hade blivit falskt ren.
import "./load-env";
import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "../src/lib/db";
import { normalizeTitle } from "../src/lib/utils";
import { detectListingLanguage, isBlockedListingLanguage } from "../src/lib/listing-language";
import { isPokemonManufacturerGtin } from "../src/lib/gtin";
import { judgeSameProduct } from "../src/lib/same-product";
import {
  cleanListingTitle,
  hasPokemonTitleSignal,
  isAccessoryListing,
  isMerchandiseListing,
  isOtherFranchiseListing,
  isSingleCardListing,
  isStoreBundleListing,
  isUnspecifiedCharacterListing,
  languageMismatch,
  mergeEquivalent,
  productsConflict,
  scoreSimilarity,
} from "../src/scrapers/matching";

// ─────────────────────────── argument ────────────────────────────
const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] ?? null : null;
};
const has = (name: string) => argv.includes(name);

const SINCE = flag("--since") ?? "2026-08-13";
const OUT = flag("--out");
const CACHE = flag("--cache") ?? path.join(process.cwd(), ".audit-cache", `new-products-${SINCE}.json`);
const REUSE = has("--reuse");
const JUDGE = has("--judge");
const JUDGE_LIMIT = Number(flag("--judge-limit") ?? 400);
const BATCH = 12;

const SEALED = ["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "BUNDLE", "COLLECTION_BOX", "TIN", "BLISTER", "OTHER"] as const;
const URL = (slug: string) => `https://www.foilio.se/produkter/${slug}`;

// ─────────────────────────── datamodell ──────────────────────────
type Row = {
  id: string;
  title: string;
  slug: string;
  category: string;
  setId: string | null;
  setName: string | null;
  gtin: string | null;
  language: string;
  createdAt: string;
  cm: boolean;
  snapshots: number;
  offers: { retailer: string; url: string | null; price: number | null }[];
};
type Cache = { since: string; readAt: string; cohort: Row[]; catalog: Row[]; setNames: string[] };

const SELECT = {
  id: true,
  title: true,
  slug: true,
  category: true,
  setId: true,
  gtin: true,
  language: true,
  createdAt: true,
  _count: { select: { priceSnapshots: true } },
  set: { select: { name: true } },
  offers: { select: { url: true, price: true, retailer: { select: { name: true } } } },
} as const;

type DbRow = {
  id: string;
  title: string;
  slug: string;
  category: string;
  setId: string | null;
  gtin: string | null;
  language: string;
  createdAt: Date;
  _count: { priceSnapshots: number };
  set: { name: string } | null;
  offers: { url: string | null; price: number | null; retailer: { name: string } }[];
};

const toRow = (r: DbRow): Row => ({
  id: r.id,
  title: r.title,
  slug: r.slug,
  category: r.category,
  setId: r.setId,
  setName: r.set?.name ?? null,
  gtin: r.gtin,
  language: r.language,
  createdAt: r.createdAt.toISOString(),
  cm: r.offers.some((o) => o.retailer.name === "Cardmarket"),
  snapshots: r._count.priceSnapshots,
  offers: r.offers.map((o) => ({ retailer: o.retailer.name, url: o.url, price: o.price })),
});

async function loadFromDb(): Promise<Cache> {
  const since = new Date(`${SINCE}T00:00:00.000Z`);
  // Kohorten = ALLA nya produkter (även SINGLE_CARD: en singel skapad av en butiksfeed
  // är i sig ett fel — auto-importen ska aldrig skapa singlar).
  const cohortRows = (await prisma.product.findMany({
    where: { createdAt: { gte: since } },
    select: SELECT,
  })) as unknown as DbRow[];
  // Jämförelsemängden = hela sealed-katalogen (dubbletter söks mot både gammalt och nytt).
  const catalogRows = (await prisma.product.findMany({
    where: { category: { in: [...SEALED] } },
    select: SELECT,
  })) as unknown as DbRow[];
  const setNames = (await prisma.cardSet.findMany({ select: { name: true } })).map((s) => s.name);
  return {
    since: SINCE,
    readAt: new Date().toISOString(),
    cohort: cohortRows.map(toRow),
    catalog: catalogRows.map(toRow),
    setNames,
  };
}

// ── Snabb Dice: förberäknade teckenbigram (identisk med scoreSimilarity) ──
type Grams = { m: Map<string, number>; total: number };
function gramsOf(s: string): Grams {
  const clean = normalizeTitle(s);
  const m = new Map<string, number>();
  for (let i = 0; i < clean.length - 1; i++) {
    const g = clean.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  let total = 0;
  for (const c of m.values()) total += c;
  return { m, total };
}
function dice(a: Grams, b: Grams, na: string, nb: string): number {
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (a.total + b.total === 0) return 0;
  const [small, big] = a.m.size <= b.m.size ? [a, b] : [b, a];
  let overlap = 0;
  for (const [g, c] of small.m) {
    const other = big.m.get(g);
    if (other) overlap += Math.min(c, other);
  }
  return (2 * overlap) / (a.total + b.total);
}

// ─────────────────────── LLM-domare A: klassificering ───────────────────────
type Classification = {
  i: number;
  pokemon: boolean;
  kind: string; // sealed | single | accessory | merch | other_franchise | unclear
  language: string; // EN | JP | CN | KR | ES | DE | FR | IT | PT | OTHER | UNKNOWN
  verdict: string; // keep | delete | review
  reason: string;
};

const CLASSIFY_SYSTEM = [
  "Du granskar nyinkomna rader i en svensk PRISKATALOG för Pokémon TCG (förseglade produkter).",
  "Katalogen får BARA innehålla förseglade Pokémon TCG-produkter (booster packs/boxar, ETB, tins, blistrar,",
  "bundles, collection boxes, premium collections) på ENGELSKA eller JAPANSKA.",
  "För VARJE titel, svara med:",
  "- pokemon: är varan en Pokémon TCG-produkt? (Pokémon-merch som gosedjur/figurer/kläder är INTE TCG → false)",
  "- kind: sealed | single | accessory | merch | other_franchise | unclear.",
  "  single = ett enskilt kort (ofta med samlarnummer som 123/195 eller ordet 'singel'/'card').",
  "  accessory = sleeves, pärm/binder, spelmatta, toploader, deck box, tärningar, kortfodral.",
  "  merch = gosedjur, figurer, kläder, muggar, affischer, pussel, leksaker.",
  "  other_franchise = annat spel/varumärke (One Piece, Lorcana, Yu-Gi-Oh, MTG, Digimon, Disney, Naruto, KPop Demon Hunters …).",
  "- language: EN | JP | CN | KR | ES | DE | FR | IT | PT | OTHER | UNKNOWN.",
  "  Svenska SÄLJORD ('Samlarkort', 'Förhandsbokning', 'Booster Display') betyder INTE svenskt kort —",
  "  svenska butiker säljer engelska produkter. Sätt EN när varan uppenbart är den engelska utgåvan.",
  "  Sätt JP bara vid japansk utgåva ('Japanese', 'JP', japansk skrift, japanska setkoder som SV5K/S12a).",
  "  Sätt CN/KR/ES/DE/FR/IT/PT bara vid tydlig evidens (språkord, lokaliserat setnamn, landskod).",
  "- verdict: keep (behåll), delete (hör inte hemma i katalogen), review (osäker/mänsklig blick krävs).",
  "  delete kräver KONKRET evidens: fel franchise, merch/tillbehör, enskilt kort, eller icke-EN/JP-språk.",
  "  Osäker utan konkret evidens → review, ALDRIG delete.",
  "- reason: max 12 ord på svenska.",
  "Svara för ALLA titlar i samma ordning, med samma i-nummer som i indatan. Anropa alltid report_batch.",
].join(" ");

const CLASSIFY_TOOL = {
  name: "report_batch",
  description: "Rapportera bedömningen för varje titel i batchen.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            i: { type: "integer" },
            pokemon: { type: "boolean" },
            kind: { type: "string", enum: ["sealed", "single", "accessory", "merch", "other_franchise", "unclear"] },
            language: {
              type: "string",
              enum: ["EN", "JP", "CN", "KR", "ES", "DE", "FR", "IT", "PT", "OTHER", "UNKNOWN"],
            },
            verdict: { type: "string", enum: ["keep", "delete", "review"] },
            reason: { type: "string" },
          },
          required: ["i", "pokemon", "kind", "language", "verdict", "reason"],
        },
      },
    },
    required: ["items"],
  },
};

let anthropic: unknown;
async function client() {
  if (anthropic !== undefined) return anthropic as { messages: { create: (a: unknown) => Promise<unknown> } } | null;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    anthropic = null;
    return null;
  }
  const mod = await import("@anthropic-ai/sdk");
  anthropic = new mod.default({ apiKey: key });
  return anthropic as { messages: { create: (a: unknown) => Promise<unknown> } };
}

const usage = { inTok: 0, outTok: 0, calls: 0 };

async function classifyBatch(items: { i: number; title: string; store: string; url: string }[]): Promise<Classification[]> {
  const c = await client();
  if (!c) return [];
  const lines = items
    .map((it) => `${it.i}. ${it.title}${it.store ? `   [butik: ${it.store}]` : ""}${it.url ? `\n    url: ${it.url}` : ""}`)
    .join("\n");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = (await c.messages.create({
        model: process.env.AUDIT_MODEL ?? "claude-haiku-4-5-20251001",
        max_tokens: 4000,
        system: CLASSIFY_SYSTEM,
        tools: [CLASSIFY_TOOL],
        tool_choice: { type: "tool", name: "report_batch" },
        messages: [{ role: "user", content: `Bedöm dessa ${items.length} titlar:\n${lines}` }],
      })) as {
        content: { type: string; input?: unknown }[];
        usage?: { input_tokens: number; output_tokens: number };
      };
      usage.calls++;
      usage.inTok += res.usage?.input_tokens ?? 0;
      usage.outTok += res.usage?.output_tokens ?? 0;
      const tool = res.content.find((b) => b.type === "tool_use");
      const out = ((tool?.input ?? {}) as { items?: Classification[] }).items ?? [];
      // ⛔ Utan indexvalidering hade en förskjuten batch tyst dömt fel produkter.
      const known = new Set(items.map((it) => it.i));
      return out.filter((o) => known.has(o.i));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 2) {
        console.warn(`[judge] batch misslyckades: ${msg}`);
        return [];
      }
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return [];
}

// ─────────────────────────────── main ────────────────────────────────
async function main() {
  let cache: Cache;
  if (REUSE && fs.existsSync(CACHE)) {
    cache = JSON.parse(fs.readFileSync(CACHE, "utf8")) as Cache;
    console.log(`Cache: ${CACHE} (läst ${cache.readAt})`);
  } else {
    cache = await loadFromDb();
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(cache), "utf8");
    console.log(`DB läst → cache: ${CACHE}`);
  }

  const { cohort, catalog } = cache;
  console.log(`Kohort (skapade ≥ ${SINCE}): ${cohort.length} produkter. Sealed-katalog: ${catalog.length}.`);

  const knownSets = new Set<string>();
  for (const name of cache.setNames) {
    for (const variant of [name, name.replace(/\(.*?\)/g, " ")]) {
      const n = normalizeTitle(variant);
      if (n.length >= 3) knownSets.add(n);
    }
  }

  const meta = (p: Row) =>
    `[${p.category}${p.setName ? `, set: ${p.setName}` : ", INGET SET"}${p.cm ? ", CM" : ""}, ` +
    `${p.offers.length} offer, ${p.snapshots} snap, ${p.language}] ${p.title}`;
  const offerLines = (p: Row) => p.offers.filter((o) => o.url).map((o) => `      ${o.retailer}: ${o.url}`);

  // ── Teknik 1–4: främmande produkter ──────────────────────────────────
  type Flag = { p: Row; why: string[]; detail: string[] };
  const flags = new Map<string, Flag>();
  const addFlag = (p: Row, why: string, detail?: string) => {
    const f = flags.get(p.id) ?? { p, why: [], detail: [] };
    if (!f.why.includes(why)) f.why.push(why);
    if (detail) f.detail.push(detail);
    flags.set(p.id, f);
  };

  for (const p of cohort) {
    // 1. SPRÅK — titel, slug OCH varje butiks-URL (slugen "…-kinesisk-version" avslöjar
    //    det titeln döljer; produktens egen slug är härledd ur titeln men URL:en är butikens).
    if (isBlockedListingLanguage(p.title, p.slug)) {
      addFlag(p, "blockerat språk", `titel/slug → ${detectListingLanguage(p.title, p.slug)}`);
    } else {
      for (const o of p.offers) {
        if (o.url && isBlockedListingLanguage(p.title, o.url)) {
          addFlag(p, "blockerat språk", `butiks-URL (${o.retailer}) → ${detectListingLanguage(p.title, o.url)}`);
          break;
        }
      }
    }
    // 2. FRÄMLING
    if (isOtherFranchiseListing(p.title)) addFlag(p, "annan franchise");
    if (isMerchandiseListing(p.title)) addFlag(p, "merch");
    if (isAccessoryListing(p.title)) addFlag(p, "tillbehör");
    if (isSingleCardListing(p.title)) addFlag(p, "enskilt kort");
    if (isStoreBundleListing(p.title)) addFlag(p, "butiksbundle/sortiment");
    if (p.category === "SINGLE_CARD" && !p.cm) addFlag(p, "SINGLE_CARD skapad av feed");
    // 3. INGEN POKÉMON-SIGNAL (bara meningsfullt för setlösa utan CM-ursprung)
    if (!p.setId && !p.cm && !hasPokemonTitleSignal(p.title, knownSets)) addFlag(p, "ingen pokémon-signal");
    // 4. KARAKTÄRSLÖS blister/mini tin utan set
    if (!p.setId && isUnspecifiedCharacterListing(p.title)) addFlag(p, "karaktärslös blister/mini tin");
  }

  // ── Teknik 5: delad tillverkar-GTIN ──────────────────────────────────
  const byGtin = new Map<string, Row[]>();
  for (const p of [...catalog, ...cohort.filter((c) => !catalog.some((k) => k.id === c.id))]) {
    if (p.gtin && isPokemonManufacturerGtin(p.gtin)) byGtin.set(p.gtin, [...(byGtin.get(p.gtin) ?? []), p]);
  }
  const cohortIds = new Set(cohort.map((p) => p.id));
  type Pair = { neu: Row; twin: Row; score: number; via: string; guards: string[] };
  const pairs: Pair[] = [];
  const pairSeen = new Set<string>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const addPair = (neu: Row, twin: Row, score: number, via: string, guards: string[]) => {
    if (neu.id === twin.id) return;
    const k = pairKey(neu.id, twin.id);
    if (pairSeen.has(k)) return;
    pairSeen.add(k);
    pairs.push({ neu, twin, score, via, guards });
  };

  for (const group of byGtin.values()) {
    if (group.length < 2) continue;
    if (!group.some((p) => cohortIds.has(p.id))) continue;
    const neu = group.find((p) => cohortIds.has(p.id))!;
    for (const other of group) addPair(neu, other, 1, "GTIN", []);
  }

  // ── Teknik 8: IDENTISK STÄDAD TITEL = bevisad dubblett (ingen LLM behövs) ────
  // ⛔ Teknik 6 nedan jämför NY.städad mot TVILLING.RÅ — rätt när tvillingen är en
  //    kanonisk katalogprodukt, men blint när BÅDA sidorna är butiksimporterade
  //    stubbar. Rogerz momstvillingar ("… / Brugtmoms" vs "… / Alm. moms") och
  //    Aquitaz självdubbletter syns bara när båda sidor städas. 172 par 2026-08-13.
  const byClean = new Map<string, Row[]>();
  for (const p of [...catalog, ...cohort.filter((c) => !catalog.some((k) => k.id === c.id))]) {
    const k = normalizeTitle(cleanListingTitle(p.title));
    if (k.length < 4) continue;
    byClean.set(k, [...(byClean.get(k) ?? []), p]);
  }
  const proven = new Set<string>();
  for (const group of byClean.values()) {
    if (group.length < 2) continue;
    if (!group.some((p) => cohortIds.has(p.id))) continue;
    // Behåll den rikaste (CM-länk > historik > flest offers); resten är dubbletterna.
    const sorted = [...group].sort(
      (x, y) => Number(y.cm) - Number(x.cm) || y.snapshots - x.snapshots || y.offers.length - x.offers.length
    );
    for (const drop of sorted.slice(1)) {
      addPair(drop, sorted[0], 1, "identisk städad titel", []);
      proven.add(pairKey(drop.id, sorted[0].id));
    }
  }

  // ── Teknik 6 + 7: titeltvillingar ────────────────────────────────────
  const grams = new Map<string, { g: Grams; n: string }>();
  const prep = (p: Row, useClean: boolean) => {
    const key = `${p.id}:${useClean ? "c" : "t"}`;
    let v = grams.get(key);
    if (!v) {
      const s = useClean ? cleanListingTitle(p.title) : p.title;
      v = { g: gramsOf(s), n: normalizeTitle(s) };
      grams.set(key, v);
    }
    return v;
  };
  const compatible = (a: string, b: string) => {
    if (a === b) return true;
    if (a === "OTHER" || b === "OTHER") return true;
    const ok = new Set(["BOOSTER_PACK|BLISTER", "BLISTER|BOOSTER_PACK"]);
    return ok.has(`${a}|${b}`);
  };

  const pool = catalog;
  for (const neu of cohort) {
    const a = prep(neu, true);
    let best: { twin: Row; score: number } | null = null;
    const sameSet: { twin: Row; score: number }[] = [];
    for (const twin of pool) {
      if (twin.id === neu.id) continue;
      if (!compatible(neu.category, twin.category)) continue;
      const b = prep(twin, false);
      const score = dice(a.g, b.g, a.n, b.n);
      if (score >= 0.9 && neu.setId && neu.setId === twin.setId && neu.category === twin.category) {
        sameSet.push({ twin, score });
      }
      if (score < 0.72) continue;
      if (!best || score > best.score) best = { twin, score };
    }
    const guardsFor = (twin: Row) => {
      const g: string[] = [];
      if (productsConflict(neu.title, twin.title)) g.push("vakt-konflikt");
      if (languageMismatch(cleanListingTitle(neu.title), twin.title)) g.push("språk-skiljer");
      if (mergeEquivalent(cleanListingTitle(neu.title), twin.title)) g.push("IDENTISK ORDMÄNGD");
      return g;
    };
    for (const s of sameSet.sort((x, y) => y.score - x.score).slice(0, 2)) {
      addPair(neu, s.twin, s.score, "samma set", guardsFor(s.twin));
    }
    if (best) addPair(neu, best.twin, best.score, "titeltvilling", guardsFor(best.twin));
  }
  pairs.sort((x, y) => y.score - x.score);

  // ── LLM-domare ───────────────────────────────────────────────────────
  const classifications = new Map<string, Classification>();
  const verdicts = new Map<string, { same: boolean; reason: string }>();
  if (JUDGE) {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("⛔ ANTHROPIC_API_KEY saknas — domaren hade returnerat null och rapporten blivit falskt ren.");
      process.exitCode = 1;
      return;
    }
    console.log(`\nLLM-domare A: klassificerar ${cohort.length} produkter i batchar om ${BATCH} …`);
    const idx = new Map<number, Row>();
    cohort.forEach((p, i) => idx.set(i, p));
    const batches: { i: number; title: string; store: string; url: string }[][] = [];
    for (let i = 0; i < cohort.length; i += BATCH) {
      batches.push(
        cohort.slice(i, i + BATCH).map((p, j) => ({
          i: i + j,
          title: p.title,
          store: p.offers[0]?.retailer ?? "",
          url: p.offers.find((o) => o.url)?.url ?? "",
        }))
      );
    }
    let done = 0;
    const CONC = 6;
    await Promise.all(
      Array.from({ length: CONC }, async (_, w) => {
        for (let b = w; b < batches.length; b += CONC) {
          const out = await classifyBatch(batches[b]);
          for (const o of out) {
            const p = idx.get(o.i);
            if (p) classifications.set(p.id, o);
          }
          done++;
          if (done % 10 === 0) process.stdout.write(`  ${done}/${batches.length} batchar\r`);
        }
      })
    );
    console.log(`  ${batches.length}/${batches.length} batchar klart. Klassificerade: ${classifications.size}.`);

    // ⛔ Bevisade par (identisk städad titel / GTIN) skickas ALDRIG till domaren:
    //    beviset är starkare än domen, och en domare som säger "olika" på ett par med
    //    identisk titel hade bara kostat pengar och sått tvivel.
    const toJudge = pairs.filter((p) => !proven.has(pairKey(p.neu.id, p.twin.id))).slice(0, JUDGE_LIMIT);
    console.log(`LLM-domare B: dömer ${toJudge.length} dubblettpar …`);
    let d2 = 0;
    await Promise.all(
      Array.from({ length: 6 }, async (_, w) => {
        for (let i = w; i < toJudge.length; i += 6) {
          const pr = toJudge[i];
          const ctx =
            `A är en butiksimporterad katalogpost (${pr.neu.category}${pr.neu.setName ? `, set ${pr.neu.setName}` : ", utan set"}), ` +
            `B en befintlig katalogprodukt (${pr.twin.category}${pr.twin.setName ? `, set ${pr.twin.setName}` : ", utan set"}${pr.twin.cm ? ", Cardmarket-länkad" : ""}).`;
          const v = await judgeSameProduct(pr.neu.title, pr.twin.title, ctx);
          if (v) verdicts.set(pairKey(pr.neu.id, pr.twin.id), v);
          d2++;
          if (d2 % 25 === 0) process.stdout.write(`  ${d2}/${toJudge.length} par\r`);
        }
      })
    );
    console.log(`  ${toJudge.length}/${toJudge.length} par klart.`);
  }

  // ─────────────────────────── rapport ───────────────────────────
  const L: string[] = [];
  const H = (t: string) => {
    L.push("");
    L.push("═".repeat(76));
    L.push(t);
    L.push("═".repeat(76));
  };

  L.push(`REVISION AV NYA KATALOGPRODUKTER — skapade ≥ ${SINCE}`);
  L.push(`Kohort: ${cohort.length} produkter · jämförd mot ${catalog.length} sealed-produkter`);
  L.push(`Genererad: ${new Date().toISOString()}${JUDGE ? " · MED LLM-dom" : " · UTAN LLM-dom"}`);

  // Butiksfördelning — vilken ny butik drog in vad
  const byStore = new Map<string, number>();
  for (const p of cohort) for (const s of new Set(p.offers.map((o) => o.retailer))) byStore.set(s, (byStore.get(s) ?? 0) + 1);
  L.push("");
  L.push("Nya produkter per butik (en produkt kan ha flera butiker):");
  for (const [s, n] of [...byStore].sort((a, b) => b[1] - a[1])) L.push(`  ${String(n).padStart(4)}  ${s}`);

  // ── SEKTION 1: RADERA (mekanisk vakt + domare överens) ──
  type Verdict = "delete" | "review" | "keep";
  const rows: { p: Row; why: string[]; detail: string[]; cls: Classification | undefined; verdict: Verdict }[] = [];
  for (const p of cohort) {
    const f = flags.get(p.id);
    const cls = classifications.get(p.id);
    const mech = f ? f.why.length > 0 : false;
    const llmBad = cls ? cls.verdict === "delete" : false;
    let verdict: Verdict = "keep";
    if (mech && llmBad) verdict = "delete";
    else if (mech || llmBad) verdict = "review";
    else if (cls && cls.verdict === "review") verdict = "review";
    if (verdict !== "keep") rows.push({ p, why: f?.why ?? [], detail: f?.detail ?? [], cls, verdict });
  }
  const clsLine = (c: Classification | undefined) =>
    c ? `    LLM: ${c.verdict.toUpperCase()} · ${c.kind} · ${c.language} · pokemon=${c.pokemon} · ${c.reason}` : "";

  const del = rows.filter((r) => r.verdict === "delete");
  H(`1. RADERA — mekanisk vakt OCH LLM-domaren säger samma sak (${del.length})`);
  L.push("   Högsta bevisnivån i rapporten. Radera + lägg URL:en i import-denylist.ts.");
  for (const r of del.sort((a, b) => a.why[0].localeCompare(b.why[0]))) {
    L.push("");
    L.push(`Delete (${r.why.join(", ")})`);
    L.push(`  ${meta(r.p)}`);
    L.push(`  ${URL(r.p.slug)}`);
    if (r.detail.length) L.push(`    detalj: ${r.detail.join("; ")}`);
    L.push(clsLine(r.cls));
    L.push(...offerLines(r.p));
  }

  const rev = rows.filter((r) => r.verdict === "review");
  H(`2. GRANSKA — bara EN av källorna flaggar (${rev.length})`);
  L.push("   Antingen såg regeln något domaren inte såg, eller tvärtom. Kräver mänsklig dom.");
  const revSorted = rev.sort((a, b) => (a.why[0] ?? "zz").localeCompare(b.why[0] ?? "zz"));
  for (const r of revSorted) {
    L.push("");
    L.push(`Granska (${r.why.length ? r.why.join(", ") : "endast LLM"})`);
    L.push(`  ${meta(r.p)}`);
    L.push(`  ${URL(r.p.slug)}`);
    if (r.detail.length) L.push(`    detalj: ${r.detail.join("; ")}`);
    if (r.cls) L.push(clsLine(r.cls));
    L.push(...offerLines(r.p));
  }

  // ── SEKTION 3: DUBBLETTER ──
  const withV = pairs.map((p) => ({
    ...p,
    proven: proven.has(pairKey(p.neu.id, p.twin.id)),
    v: verdicts.get(pairKey(p.neu.id, p.twin.id)),
  }));
  const confirmed = withV.filter((p) => p.proven || p.v?.same === true);
  const rejected = withV.filter((p) => !p.proven && p.v?.same === false);
  const unjudged = withV.filter((p) => !p.proven && !p.v);

  H(`3. DUBBLETTER — bevisade eller bekräftade av domaren (${confirmed.length})`);
  L.push(`   varav ${confirmed.filter((p) => p.proven).length} BEVISADE (identisk städad titel/GTIN — ingen dom behövs).`);
  L.push("   Format: raden som ska bort först, målet under 'Goes to'. Behåll den med CM-länk/historik.");
  for (const p of confirmed) {
    const keep = p.twin.cm !== p.neu.cm ? (p.twin.cm ? p.twin : p.neu) : p.twin.snapshots >= p.neu.snapshots ? p.twin : p.neu;
    const drop = keep.id === p.twin.id ? p.neu : p.twin;
    L.push("");
    L.push(
      `Duplicates (${p.proven ? "BEVISAD · " : ""}${p.via}, poäng ${p.score.toFixed(3)}${p.guards.length ? " · " + p.guards.join(", ") : ""})`
    );
    L.push(`  ${meta(drop)}`);
    L.push(`  ${URL(drop.slug)}`);
    L.push(...offerLines(drop));
    L.push("Goes to");
    L.push(`  ${meta(keep)}`);
    L.push(`  ${URL(keep.slug)}`);
    if (p.v) L.push(`    LLM: ${p.v.reason}`);
  }

  H(`4. DUBBLETTKANDIDATER — domaren säger OLIKA produkter (${rejected.length})`);
  L.push("   Redovisas för att domaren kan ha fel på gränsfall (t.ex. varianter). Ingen åtgärd som standard.");
  for (const p of rejected.slice(0, 120)) {
    L.push("");
    L.push(`Ej dubblett (${p.via}, ${p.score.toFixed(3)}): ${p.neu.title}`);
    L.push(`   vs: ${p.twin.title}`);
    L.push(`   LLM: ${p.v?.reason ?? ""}`);
  }
  if (rejected.length > 120) L.push(`\n… ${rejected.length - 120} till (utelämnade).`);

  if (unjudged.length) {
    H(`5. DUBBLETTKANDIDATER UTAN DOM (${unjudged.length})`);
    L.push("   Kör med --judge (eller höj --judge-limit) för att avgöra dessa.");
    for (const p of unjudged.slice(0, 200)) {
      L.push("");
      L.push(`Kandidat (${p.via}, ${p.score.toFixed(3)}${p.guards.length ? " · " + p.guards.join(", ") : ""})`);
      L.push(`  ${meta(p.neu)}\n  ${URL(p.neu.slug)}`);
      L.push(`Goes to\n  ${meta(p.twin)}\n  ${URL(p.twin.slug)}`);
    }
    if (unjudged.length > 200) L.push(`\n… ${unjudged.length - 200} till (utelämnade).`);
  }

  // ── SEKTION 6: LLM-språkfördelning (fångar det regexen missar) ──
  if (JUDGE) {
    H("6. SPRÅKFÖRDELNING enligt domaren (regexen ser bara det som är utskrivet)");
    const byLang = new Map<string, Row[]>();
    for (const p of cohort) {
      const c = classifications.get(p.id);
      if (!c) continue;
      byLang.set(c.language, [...(byLang.get(c.language) ?? []), p]);
    }
    for (const [lang, ps] of [...byLang].sort((a, b) => b[1].length - a[1].length)) {
      L.push(`  ${String(ps.length).padStart(4)}  ${lang}`);
    }
    const foreign = [...byLang].filter(([l]) => !["EN", "JP", "UNKNOWN"].includes(l));
    for (const [lang, ps] of foreign) {
      L.push("");
      L.push(`— ${lang} (${ps.length}) —`);
      for (const p of ps) {
        L.push(`  ${p.title}`);
        L.push(`  ${URL(p.slug)}   [DB-språk: ${p.language}]`);
        L.push(...offerLines(p));
      }
    }
    const kinds = new Map<string, number>();
    for (const c of classifications.values()) kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1);
    L.push("");
    L.push("Formfördelning enligt domaren:");
    for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1])) L.push(`  ${String(n).padStart(4)}  ${k}`);
  }

  // ── Sammanfattning ──
  H("SAMMANFATTNING");
  L.push(`  Kohort:                        ${cohort.length}`);
  L.push(`  Flaggade av mekanisk vakt:     ${flags.size}`);
  L.push(`  RADERA (båda överens):         ${del.length}`);
  L.push(`  GRANSKA (en källa):            ${rev.length}`);
  L.push(`  Dubblettpar (kandidater):      ${pairs.length}`);
  L.push(`  Dubbletter bekräftade av LLM:  ${confirmed.length}`);
  if (JUDGE) {
    const cost = (usage.inTok / 1e6) * 1 + (usage.outTok / 1e6) * 5;
    L.push(
      `  LLM: ${usage.calls} batch-anrop (${usage.inTok} in / ${usage.outTok} ut tokens) + ${verdicts.size} pardomar ≈ $${cost.toFixed(3)} (batchdelen)`
    );
  }

  const report = L.join("\n") + "\n";
  if (OUT) {
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, report, "utf8");
    console.log(`\nRapport: ${OUT}`);
  } else {
    console.log("\n" + report);
  }

  // Maskinläsbart facit bredvid rapporten — nästa steg (merge/radering) läser detta.
  const jsonOut = (OUT ?? CACHE).replace(/\.[^.]+$/, "") + ".findings.json";
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        since: SINCE,
        generatedAt: new Date().toISOString(),
        judged: JUDGE,
        delete: del.map((r) => ({ id: r.p.id, slug: r.p.slug, title: r.p.title, why: r.why, llm: r.cls })),
        review: rev.map((r) => ({ id: r.p.id, slug: r.p.slug, title: r.p.title, why: r.why, llm: r.cls })),
        duplicates: confirmed.map((p) => ({
          via: p.via,
          proven: p.proven,
          score: p.score,
          a: { id: p.neu.id, slug: p.neu.slug, title: p.neu.title, cm: p.neu.cm, snapshots: p.neu.snapshots },
          b: { id: p.twin.id, slug: p.twin.slug, title: p.twin.title, cm: p.twin.cm, snapshots: p.twin.snapshots },
          reason: p.v?.reason,
        })),
        rejectedPairs: rejected.map((p) => ({ a: p.neu.title, b: p.twin.title, score: p.score, reason: p.v?.reason })),
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(`Facit (JSON): ${jsonOut}`);
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
