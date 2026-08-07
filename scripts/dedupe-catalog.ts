/**
 * KATALOGDUBBLETTER — hittar produkter som är samma vara och slår ihop dem.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/dedupe-catalog.ts            # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/dedupe-catalog.ts --apply
 *
 * VARFÖR DET HÄR OCH INTE BARA matchProduct: matcharens poäng räcker för att LÄNKA
 * en annons till en produkt (fel länk syns direkt och rättas), men en SAMMANSLAGNING
 * raderar en katalogpost. Därför krävs här det deterministiska beviset — identiska
 * identitets-ordmängder, samma form, inga konflikter — aldrig bara ett Dice-tal.
 * Allt som inte klarar det hamnar i rapporten i stället, för en människa.
 */
import { prisma } from "../src/lib/db";
import {
  matchProduct,
  identicalIdentity,
  productsConflict,
  regionVersionMismatch,
  blisterCharacterMismatch,
  classifyForm,
} from "../src/scrapers/matching";
import { normalizeTitle } from "../src/lib/utils";
import { mergeStubInto, mergeWouldLoseTrackRecord } from "../src/jobs/dedupe-stubs";

const APPLY = process.argv.includes("--apply");

/**
 * BEVISET FÖR EN SAMMANSLAGNING TAS PÅ RÅTITELN, INTE PÅ DEN NORMALISERADE.
 *
 * `normalizeTitle` kastar korta tokens ("X", "Y", "2", "GO") och parenteser — precis
 * de tecken som skiljer olika SKU:er åt. Mätt 2026-08-07 gav en identitetsjämförelse
 * på normaliserade titlar dessa "säkra" par:
 *   "Mega Charizard X ex Tin"  == "Mega Charizard Y ex Tin"   (1,00!)
 *   "Base Set 2 Booster Pack"  == "Base Booster Pack"         (0,99)
 *   "XY Booster Pack"          == "Pokémon GO Booster Pack"   (0,82)
 *   "Paldean Fates: … (US Version)" == "Paldean Fates: …"     (1,00)
 * Alla fyra är olika varor. Att LÄNKA en annons fel syns och rättas; att SLÅ IHOP
 * raderar en katalogpost med historik. Därför jämförs här ordmängden ur råtiteln,
 * med korta tokens kvar.
 */
const NOISE = new Set([
  "pokemon", "pokémon", "tcg", "the", "and", "och", "med", "för", "trading", "card", "cards", "game",
  // Era-fraser: butiken skriver dem, katalogen ofta inte. De är aldrig det som
  // skiljer två produkter åt när allt annat är lika.
  "scarlet", "violet", "sword", "shield", "sun", "moon",
]);
const FORMWORDS = new Set([
  "booster", "boosters", "box", "display", "pack", "packs", "blister", "elite", "trainer", "etb",
  "bundle", "collection", "tin", "case", "premium",
]);

/**
 * "Checklane" = 1-pack. Cardmarket namnger samma vara båda sätten och listar exakt
 * EN blister per set+karaktär (mätt: 486 blistrar, 4 undantag och alla fyra skiljer
 * sig på ANTALET — 1 mot 3, 3 mot 4 — vilket räkneorden nedan fångar).
 */
function identityTokens(title: string): Set<string> {
  const t = title
    .toLowerCase()
    .replace(/[()[\]]/g, " ")
    .replace(/[^a-z0-9åäö]+/g, " ")
    .replace(/\bchecklane\b/g, "1 pack")
    .trim();
  const out = new Set<string>();
  const toks = t.split(/\s+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (NOISE.has(tok)) continue;
    // Butikens egen era-numrering ("Scarlet & Violet 5:", "Mega Evolution 2.5")
    // är inte produktidentitet — den står direkt efter ett era-ord.
    if (/^\d+(\.\d+)?$/.test(tok) && i > 0 && NOISE.has(toks[i - 1])) continue;
    if (FORMWORDS.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

function sameIdentity(a: string, b: string): boolean {
  const sa = identityTokens(a);
  const sb = identityTokens(b);
  if (sa.size === 0 || sb.size === 0) return false;
  if (sa.size !== sb.size) return false;
  for (const t of sa) if (!sb.has(t)) return false;
  return true;
}

interface Pair {
  a: { id: string; title: string; imageUrl: string | null };
  b: { id: string; title: string; imageUrl: string | null };
  score: number;
  reason: string;
}

async function main() {
  const products = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    select: { id: true, title: true, normalizedTitle: true, imageUrl: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Granskar ${products.length} sealed-produkter.\n`);

  const confident: Pair[] = [];
  const review: Pair[] = [];
  const seen = new Set<string>();

  for (const p of products) {
    if (seen.has(p.id)) continue;
    const m = await matchProduct(p.normalizedTitle, undefined, p.title, p.id);
    if (!m) continue;
    const other = await prisma.product.findUnique({
      where: { id: m.productId },
      select: { id: true, title: true, normalizedTitle: true, imageUrl: true },
    });
    if (!other || seen.has(other.id)) continue;

    const na = normalizeTitle(p.title);
    const nb = normalizeTitle(other.title);
    const formA = classifyForm(na);
    const formB = classifyForm(nb);

    const checks: [string, boolean][] = [
      // Råtitel-beviset FÖRST — se kommentaren vid identityTokens.
      ["råtitel-identitet", sameIdentity(p.title, other.title)],
      ["identitet", identicalIdentity(na, nb)],
      ["ingen konflikt", !productsConflict(na, nb)],
      ["samma form", !formA || !formB || formA === formB],
      ["ingen regionskillnad", !regionVersionMismatch(p.title, nb)],
      ["blisterkaraktär", !blisterCharacterMismatch(p.title, nb)],
    ];
    const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
    const pair: Pair = {
      a: p,
      b: other,
      score: m.confidence,
      reason: failed.length ? `faller på: ${failed.join(", ")}` : "alla bevis stämmer",
    };
    if (failed.length === 0) {
      confident.push(pair);
      seen.add(p.id);
      seen.add(other.id);
    } else {
      review.push(pair);
    }
  }

  console.log(`SÄKRA (slås ihop): ${confident.length}`);
  for (const c of confident)
    console.log(`   ${c.score.toFixed(2)}  "${c.a.title}"\n           == "${c.b.title}"`);
  console.log(`\nTILL GRANSKNING (rörs inte): ${review.length}`);
  for (const r of review.slice(0, 40))
    console.log(`   ${r.score.toFixed(2)}  "${r.a.title}"\n           ?= "${r.b.title}"   [${r.reason}]`);
  if (review.length > 40) console.log(`   … och ${review.length - 40} till`);

  if (!APPLY) {
    console.log("\nTorrkörning — inget skrevs. Lägg till --apply.");
    return;
  }

  let merged = 0;
  for (const c of confident) {
    // Vilken post ska överleva? Den med mest historik/data. Hjälpfunktionen svarar
    // "skulle vi förlora spårhistorik" — är svaret ja åt ena hållet vänder vi på det.
    let stub = c.a;
    let canon = c.b;
    if (await mergeWouldLoseTrackRecord(stub.id, canon.id)) {
      [stub, canon] = [canon, stub];
      if (await mergeWouldLoseTrackRecord(stub.id, canon.id)) {
        console.log(`   HOPPAR ÖVER (båda bär historik): "${c.a.title}" / "${c.b.title}"`);
        continue;
      }
    }
    // Bilden får aldrig gå förlorad i en merge.
    if (!canon.imageUrl && stub.imageUrl) {
      await prisma.product.update({ where: { id: canon.id }, data: { imageUrl: stub.imageUrl } });
    }
    await mergeStubInto(stub.id, canon.id);
    merged++;
    console.log(`   ✓ "${stub.title}" → "${canon.title}"`);
  }
  console.log(`\nSammanslagna: ${merged}`);
}

main().finally(() => prisma.$disconnect());
