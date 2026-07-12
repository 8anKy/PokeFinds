/**
 * Katalog-bred dubblettstädning för sealed-produkter (dedupe-stubs tar bara
 * FÄRSKA set-lösa stubbar — den här sveper HELA katalogen, oavsett ålder).
 *
 * Kandidatpar: (1) titel-likhet ≥ MIN_SIM inom samma/kompatibel kategori eller
 * samma produktform, (2) par som DELAR butiks-/CM-/Tradera-URL (stark signal).
 * Hårda vakter (serie-/sifferset-/språk-/PC-/tin-display-mismatch) filtrerar,
 * LLM-domen (Haiku via judgeSameProduct) fäller avgörandet, mergeStubInto
 * flyttar offers/bevakningar/samlingar till överlevaren.
 *
 * Överlevare: set-märkt > exakt CM-id-offer > äldst. Kategori self-heal: om
 * överlevarens titelform entydigt säger annan kategori (display/booster/etb/tin)
 * rättas den.
 *
 * KOSTNADSVAKTER (2026-07-07: en DRY-RUN dömde 29 842 par med Haiku och TÖMDE
 * API-kontot — $7,43, ~8 250 anrop innan saldot tog slut mitt i körningen):
 *   1. DRY-RUN rör ALDRIG LLM:en. Den listar bara kandidatparen. Att "bara titta"
 *      får inte kunna kosta pengar.
 *   2. MAX_PAIRS (default 500) — fler par än så = avbryt, inte "kör ändå". Sänkt
 *      MIN_SIM får inte kunna återladda vapnet.
 *   3. Uppskattad kostnad skrivs ut FÖRE första anropet.
 *
 * Kör:
 *   DUMP=1   → skriv kandidatparen som JSON (gratis, för manuell/Claude-granskning)
 *   (inget)  → DRY-RUN: lista par, ingen LLM, ingen kostnad
 *   JUDGE=1  → döm med Haiku men skriv inte (kostar pengar, respekterar MAX_PAIRS)
 *   VERDICTS=<fil.json> APPLY=1 → applicera FÄRDIGA domar utan ett enda API-anrop
 *   APPLY=1  → döm med Haiku OCH merga
 * Alltid: DATABASE_URL=<neon> npx tsx scripts/dedupe-catalog.ts
 */
import * as fs from "fs";
import { PrismaClient } from "@prisma/client";
import { prisma as appPrisma } from "../src/lib/db";
import { mapPool } from "../src/lib/concurrency";
import { judgeSameProduct } from "../src/lib/same-product";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import {
  classifyForm,
  cleanListingTitle,
  languageMismatch,
  nonEraCoverage,
  pokemonCenterMismatch,
  scoreSimilarity,
  seriesMismatch,
  setMarkerMismatch,
} from "../src/scrapers/matching";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";
const MIN_SIM = Number(process.env.MIN_SIM ?? "0.5");
/** Tak för hur många par som får skickas till LLM:en i EN körning. Fler = avbryt.
 *  Detta är skillnaden mellan "en dyr körning" och "ett tömt konto". */
const MAX_PAIRS = Number(process.env.MAX_PAIRS ?? "500");
/** Färdiga domar från fil (t.ex. adjudicerade i Claude Code) → noll API-kostnad. */
const VERDICTS_FILE = process.env.VERDICTS ?? "";
/** Kostar pengar? Bara när vi faktiskt ringer Anthropic. DRY-RUN gör det ALDRIG. */
const USE_LLM = !VERDICTS_FILE && (APPLY || process.env.JUDGE === "1");
/** Haiku 4.5: ~500 in + ~75 ut per dom ≈ $0,0009. Räcker för en grov förhandsvarning. */
const USD_PER_JUDGEMENT = 0.0009;

type Verdict = { same: boolean; reason: string } | null;

/** Läser domar från VERDICTS-filen. Format: [{ a, b, same, reason }] där a/b = produkt-id. */
function loadVerdicts(path: string): Map<string, Verdict> {
  const raw = JSON.parse(fs.readFileSync(path, "utf8")) as {
    a: string;
    b: string;
    same: boolean;
    reason?: string;
  }[];
  const m = new Map<string, Verdict>();
  for (const v of raw) {
    m.set([v.a, v.b].sort().join("|"), { same: v.same, reason: v.reason ?? "från VERDICTS-fil" });
  }
  return m;
}

const COMPATIBLE = new Set(["BOOSTER_PACK|BLISTER", "BLISTER|BOOSTER_PACK"]);
const FORM_CATEGORY: Record<string, string> = {
  display: "BOOSTER_BOX",
  booster: "BOOSTER_PACK",
  etb: "ETB",
  tin: "TIN",
};

type P = {
  id: string;
  title: string;
  category: string;
  language: string;
  setId: string | null;
  createdAt: Date;
  offers: { retailerId: string; url: string | null; retailerName: string }[];
  watchers: number;
};

/** Parentes-antal som är CM-produktidentitet: "(5 Cards)"-minipack, "(18 Boosters)"-
 *  halvdisplay osv. 36 = standardbox → brus, allt annat = egen SKU. */
function countIdentity(t: string): string | null {
  const cards = /\((\d+) ?(?:cards?|kort)\)/i.exec(t);
  if (cards) return `cards${cards[1]}`;
  // 36 = EN-standardbox, 30 = JP-standardbox → brus. Övrigt (18-halvdisplay …) = SKU.
  const packs = /\((\d+) ?(?:boosters?|packs?|paket)\)/i.exec(t);
  if (packs && packs[1] !== "36" && packs[1] !== "30") return `packs${packs[1]}`;
  return null;
}

const US_VERSION = /\bus version\b/i;

function guardsBlock(a: P, b: P): boolean {
  const ta = cleanListingTitle(a.title);
  const tb = cleanListingTitle(b.title);
  if (seriesMismatch(ta, tb)) return true;
  if (setMarkerMismatch(ta, tb)) return true;
  if (languageMismatch(ta, tb)) return true;
  if (pokemonCenterMismatch(ta, tb)) return true;
  // Produkter i olika språk-kolumner är aldrig samma SKU (JP ≠ EN).
  if (a.language !== b.language) return true;
  // Tin-display ≠ enskild tin (hård mekanisk spärr).
  if (
    (a.category === "TIN" || b.category === "TIN") &&
    /\bdisplay\b/i.test(ta) !== /\bdisplay\b/i.test(tb)
  )
    return true;
  // Cardmarket listar US-/EU-tinversioner som SEPARATA produkter (750590 ≠ 750591)
  // — "(US Version)" på ena sidan = olika SKU:er.
  if (US_VERSION.test(a.title) !== US_VERSION.test(b.title)) return true;
  // "(5 Cards)"/"(6 Cards)"-minipack och "(18 Boosters)"-halvdisplayer är EGNA
  // CM-SKU:er ("Flashfire Booster" 271862 ≠ "Flashfire Booster (5 Cards)" 562429).
  // OBS: räknas på RÅ titel (cleanListingTitle strippar innehållsräknare).
  if (countIdentity(a.title) !== countIdentity(b.title)) return true;
  // Identitetskrav ÄVEN för delade-URL-par: båda titlarna måste bära ≥1 eget
  // identitetsord och täcka varandras ("SWSH Booster Pack" ← "Rebel Clash Booster"
  // delade CM-URL men är olika set; "XY ETB" och "Mega Evolution ETB" har båda
  // NOLL identitetsord kvar efter era-strip → odömbara, hoppa).
  if (nonEraCoverage(ta, "x") === 1 || nonEraCoverage(tb, "x") === 1) return true;
  if (nonEraCoverage(ta, tb) < 0.99 || nonEraCoverage(tb, ta) < 0.99) return true;
  return false;
}

function compatible(a: P, b: P): boolean {
  if (a.category === b.category) return true;
  if (COMPATIBLE.has(`${a.category}|${b.category}`)) return true;
  // Miscategoriserade dubbletter ("… Booster Japansk Display" som BOOSTER_PACK):
  // samma entydiga titelform räcker.
  const fa = classifyForm(cleanListingTitle(a.title));
  const fb = classifyForm(cleanListingTitle(b.title));
  return fa != null && fa === fb;
}

/** Vem överlever en merge? set-märkt > CM-id-offer > flest watchers > äldst. */
function pickSurvivor(a: P, b: P): [P, P] {
  const score = (p: P) =>
    (p.setId != null ? 100 : 0) +
    (p.offers.some((o) => o.retailerName === "Cardmarket" && /idProduct=/.test(o.url ?? "")) ? 10 : 0) +
    Math.min(p.watchers, 5);
  const sa = score(a);
  const sb = score(b);
  if (sa !== sb) return sa > sb ? [a, b] : [b, a];
  return a.createdAt <= b.createdAt ? [a, b] : [b, a];
}

async function main() {
  const db = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  const mode = APPLY ? "APPLY" : USE_LLM ? "JUDGE (ingen skrivning)" : "DRY-RUN";
  const cost = VERDICTS_FILE ? "domar från fil — 0 API-anrop" : USE_LLM ? "LLM PÅ — kostar pengar" : "ingen LLM — gratis";
  console.log(`DB: ${db[0].db} — ${mode} — ${cost}`);
  // Nyckeln krävs BARA när vi faktiskt ska ringa. Förut dog en gratis DRY-RUN här
  // utan nyckel, och lyckades ringa 8 250 gånger med den.
  if (USE_LLM && !process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY saknas — krävs för APPLY/JUDGE (kör utan flaggor för gratis DRY-RUN).");
    process.exit(1);
  }

  const rows = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] } },
    select: {
      id: true, title: true, category: true, language: true, setId: true, createdAt: true,
      offers: { select: { retailerId: true, url: true, retailer: { select: { name: true } } } },
      _count: { select: { watchlistItems: true } },
    },
  });
  const products: P[] = rows.map((r) => ({
    id: r.id, title: r.title, category: r.category, language: r.language,
    setId: r.setId, createdAt: r.createdAt,
    offers: r.offers.map((o) => ({ retailerId: o.retailerId, url: o.url, retailerName: o.retailer.name })),
    watchers: r._count.watchlistItems,
  }));
  console.log(`${products.length} sealed-produkter.`);

  // Kandidatpar
  const pairKey = (a: P, b: P) => [a.id, b.id].sort().join("|");
  const pairs = new Map<string, { a: P; b: P; why: string; sim: number }>();

  // 1) Delad URL (även CM-idProduct) — stark dubblettsignal.
  const byUrl = new Map<string, P[]>();
  for (const p of products)
    for (const o of p.offers) {
      if (!o.url) continue;
      const key = `${o.retailerName}::${o.url}`;
      (byUrl.get(key) ?? byUrl.set(key, []).get(key)!).push(p);
    }
  for (const [url, owners] of byUrl) {
    const uniq = [...new Map(owners.map((p) => [p.id, p])).values()];
    for (let i = 0; i < uniq.length; i++)
      for (let j = i + 1; j < uniq.length; j++) {
        const a = uniq[i], b = uniq[j];
        if (guardsBlock(a, b) || !compatible(a, b)) continue;
        pairs.set(pairKey(a, b), { a, b, why: `delad URL ${url.slice(0, 80)}`, sim: scoreSimilarity(a.title, b.title) });
      }
  }

  // 2) Identitets-ekvivalens inom kategori/form: BÅDA titlarnas särskiljande
  //    icke-era-ord måste täckas av den andra (nonEraCoverage åt båda håll).
  //    Dubblettpar är samma identitet med olika brus ("Temporal Forces: Cleffa
  //    3-Pack Blister" ↔ "…SV Temporal Forces 3-pack Blister - Cleffa"); olika
  //    produkter skiljer sig i ≥1 identitetsord (Cleffa ≠ Cyclizar) och faller.
  //    Ren titel-likhet (Dice ≥ 0.5) gav 29 842 par — ohanterligt; detta ger
  //    storleksordningar färre med bättre precision. Par som delar URL fångas
  //    ändå av (1) ovan även när orden divergerar.
  for (let i = 0; i < products.length; i++) {
    for (let j = i + 1; j < products.length; j++) {
      const a = products[i], b = products[j];
      if (!compatible(a, b) || guardsBlock(a, b)) continue;
      const ta = cleanListingTitle(a.title);
      const tb = cleanListingTitle(b.title);
      if (nonEraCoverage(ta, tb) < 0.99 || nonEraCoverage(tb, ta) < 0.99) continue;
      const sim = scoreSimilarity(ta, tb);
      if (sim < MIN_SIM) continue;
      const k = pairKey(a, b);
      if (!pairs.has(k)) pairs.set(k, { a, b, why: "identitets-ekvivalens", sim });
    }
  }
  console.log(`${pairs.size} kandidatpar → LLM-dom.`);

  // DUMP=1: skriv kandidatparen som JSON (för manuell granskning) och avsluta.
  if (process.env.DUMP === "1") {
    const out = [...pairs.values()].map(({ a, b, why, sim }) => ({
      a: { id: a.id, title: a.title, category: a.category, setId: a.setId, offers: a.offers.length },
      b: { id: b.id, title: b.title, category: b.category, setId: b.setId, offers: b.offers.length },
      why, sim: Number(sim.toFixed(2)),
    }));
    console.log(JSON.stringify(out, null, 1));
    return;
  }

  const sorted = [...pairs.values()].sort((x, y) => y.sim - x.sim);

  // TAK: hellre avbryta än tömma kontot. Ett par-antal i den här storleksordningen
  // betyder ALLTID att filtren släppt igenom skräp (sänkt MIN_SIM, trasig guard) —
  // inte att katalogen plötsligt har tusentals dubbletter.
  if (sorted.length > MAX_PAIRS) {
    console.error(
      `\n✋ AVBRYTER: ${sorted.length} kandidatpar > MAX_PAIRS (${MAX_PAIRS}).` +
        `\n   Att döma dem skulle kosta ~$${(sorted.length * USD_PER_JUDGEMENT).toFixed(2)} i Haiku-anrop.` +
        `\n   Höj MIN_SIM (nu ${MIN_SIM}), granska med DUMP=1, eller höj MAX_PAIRS medvetet.`
    );
    process.exit(1);
  }

  // DRY-RUN: lista paren, ring INGEN. Att titta ska vara gratis.
  if (!USE_LLM && !VERDICTS_FILE) {
    for (const { a, b, why, sim } of sorted) {
      console.log(`  ? "${a.title}" (${a.id})\n    vs "${b.title}" (${b.id})  [${why}, sim ${sim.toFixed(2)}]`);
    }
    console.log(
      `\n${sorted.length} kandidatpar. INGEN LLM anropad (DRY-RUN = gratis).` +
        `\n  JUDGE=1 → döm med Haiku (~$${(sorted.length * USD_PER_JUDGEMENT).toFixed(2)})` +
        `\n  DUMP=1  → JSON för granskning, applicera sedan med VERDICTS=<fil> APPLY=1 (gratis)`
    );
    return;
  }

  const verdicts: { pair: (typeof sorted)[number]; v: Verdict }[] = new Array(sorted.length);
  if (VERDICTS_FILE) {
    const preset = loadVerdicts(VERDICTS_FILE);
    let missing = 0;
    sorted.forEach((pair, i) => {
      const v = preset.get([pair.a.id, pair.b.id].sort().join("|")) ?? null;
      if (!v) missing++;
      verdicts[i] = { pair, v };
    });
    console.log(`${preset.size} domar lästa från ${VERDICTS_FILE} — ${missing} par utan dom (hoppas över). 0 API-anrop.`);
  } else {
    console.log(`Dömer ${sorted.length} par med Haiku — uppskattad kostnad ~$${(sorted.length * USD_PER_JUDGEMENT).toFixed(2)}.`);
    await mapPool(sorted, 8, async (pair, i) => {
      verdicts[i] = { pair, v: await judgeSameProduct(pair.a.title, pair.b.title) };
    });
  }

  const merged = new Set<string>();
  let confirmed = 0, rejected = 0;
  const llmCalls = VERDICTS_FILE ? 0 : sorted.length;
  for (const { pair, v } of verdicts) {
    const { a, b, why, sim } = pair;
    if (merged.has(a.id) || merged.has(b.id)) continue;
    if (!v) { console.log(`  ⚠ ingen dom (LLM-fel/saknas i fil), hoppar: "${a.title}" vs "${b.title}"`); continue; }
    if (!v.same) { rejected++; continue; }
    const [survivor, loser] = pickSurvivor(a, b);
    confirmed++;
    console.log(`  ✔ SAMMA [${why}, sim ${sim.toFixed(2)}]`);
    console.log(`      behåll: "${survivor.title}" (${survivor.id})`);
    console.log(`      merge:  "${loser.title}" (${loser.id}) — ${v.reason}`);
    if (APPLY) {
      await mergeStubInto(loser.id, survivor.id);
      merged.add(loser.id);
      // Kategori-self-heal på överlevaren vid entydig titelform.
      const form = classifyForm(cleanListingTitle(survivor.title));
      const want = form ? FORM_CATEGORY[form] : undefined;
      if (want && want !== survivor.category) {
        await prisma.product.update({ where: { id: survivor.id }, data: { category: want as never } });
        console.log(`      kategori rättad: ${survivor.category} → ${want}`);
      }
    } else {
      merged.add(loser.id);
    }
  }

  console.log(`\nKlart: ${confirmed} bekräftade dubbletter, ${rejected} avvisade, ${llmCalls} LLM-anrop. ${APPLY ? "" : "(DRY-RUN — inget skrivet)"}`);
}

main().finally(async () => {
  await prisma.$disconnect();
  await appPrisma.$disconnect();
});
