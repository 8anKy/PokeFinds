/**
 * CM-LÄNK-MISSMATCH-RAPPORT: sealed-produkter vars Cardmarket-offer pekar på ett idProduct
 * vars CM-KATALOGNAMN inte liknar vår produkttitel — dvs sannolikt FEL sealed-länk (spårar
 * fel varas pris). Kompletterar cm-single-link-report.ts: den fångar sealed→SINGEL (idProduct
 * saknas i sealed-katalogen); DEN HÄR fångar sealed→FEL SEALED (idProduct FINNS men är fel vara).
 *
 * Bakgrund 2026-07-17: ägaren hittade "2022 Water Stacking Tin"→"Tapu Lele Blister" och
 * "Meowth VMAX Collection"→"Tyrantrum Blister" (6500 kr) via "Biggest drops". Fuzzy-matchningen
 * kan RE-mismatcha korrekt länkade produkter. Den här rapporten kör titel↔CM-katalognamn-likhet
 * (Dice på normaliserade namn) och listar de minst lika för MÄNSKLIG granskning.
 *
 * INFORMATIV (blir aldrig röd): normaliseringen kan inte helt undvika falska positiva
 * (generiska namn, reprint-koder). Läs listan och repeka bekräftade fel via with-prod-db +
 * cardmarketProductUrl. Se [[project_cm_single_link_mismatch]].
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-link-mismatch-report.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-link-mismatch-report.ts --threshold 0.4
 */
import { PrismaClient } from "@prisma/client";
import { formatPrice } from "../src/lib/format";

const prisma = new PrismaClient();
const CM_NONSINGLES_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";
const SEALED = ["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "BUNDLE", "COLLECTION_BOX", "TIN", "BLISTER"] as const;

const arg = (f: string) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const THRESHOLD = Number(arg("--threshold") ?? 0.34);

/**
 * Normaliserar till jämförbara tokens. Strippar BARA generiskt brus (pokemon/tcg/språk) och
 * JP-era-prefix + set-koder som CM utelämnar — men BEHÅLLER set-namn (XY, 151, Violet …),
 * karaktärer och produkttyp. (En för aggressiv strippning gav falska positiva: "XY Booster
 * Box" ↔ "XY Booster Box" blev tomma tokenmängder → sim 0 fast korrekt.)
 */
function toks(s: string): Set<string> {
  const n = s
    .toLowerCase()
    .replace(/&amp;|&/g, "and")
    .replace(/[^a-z0-9 ]/g, " ")
    // generiskt brus
    .replace(/\b(pokemon|pokémon|tcg|the|a|of|japansk\w*|japanese|jpn?|card|display)\b/g, " ")
    // JP-era-prefix som CM utelämnar (vår titel bär dem, CM inte)
    .replace(/\b(scarlet\s+and\s+violet|scarlet\s+violet|sword\s+and\s+shield|sword\s+shield|sun\s+and\s+moon|sun\s+moon)\b/g, " ")
    // set-koder MED siffror (sv7a, s12a, sm10b, m1L, swsh12) — men INTE bara "xy"/"bw" (set-namn)
    .replace(/\b(sv|s|sm|swsh|m)\d{1,2}[a-z]?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return new Set(n.split(" ").filter((t) => t.length > 1));
}
function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return (2 * i) / (a.size + b.size);
}

/** Titel↔CM-katalognamn-likhet [0,1]. Exporterad för test. Lågt = sannolikt fel länk. */
export function linkSimilarity(ourTitle: string, cmName: string): number {
  return dice(toks(ourTitle), toks(cmName));
}

async function main() {
  const r = await fetch(CM_NONSINGLES_URL);
  if (!r.ok) {
    console.error(`[cm-mismatch] kunde inte hämta CM-katalogen: HTTP ${r.status}`);
    process.exit(0);
  }
  const catName = new Map(
    ((await r.json()) as { products: { idProduct: number; name: string }[] }).products.map((p) => [p.idProduct, p.name])
  );

  const offers = await prisma.offer.findMany({
    where: { retailer: { name: "Cardmarket" }, product: { category: { in: [...SEALED] } }, url: { contains: "idProduct=" } },
    select: { url: true, price: true, product: { select: { title: true, slug: true, language: true, category: true } } },
  });

  const suspects = offers
    .map((o) => {
      const id = Number(o.url.match(/idProduct=(\d+)/)?.[1]);
      const cn = catName.get(id);
      return cn ? { id, cn, o, sim: dice(toks(o.product.title), toks(cn)) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null && x.sim < THRESHOLD)
    .sort((a, b) => a.sim - b.sim);

  console.log(
    `\n=== SEALED CM-LÄNKAR MED LÅG TITEL↔CM-NAMN-LIKHET (<${THRESHOLD}) — ${suspects.length} att granska ===`
  );
  console.log(
    "  INFORMATIV: en del är falska positiva (generiska/reprint-namn). Granska; repeka bekräftade fel.\n"
  );
  if (suspects.length === 0) console.log("  Inga misstänkta.");
  for (const s of suspects) {
    console.log(`  sim=${s.sim.toFixed(2)} [${s.o.product.language}] ${s.o.product.title}`);
    console.log(
      `           → CM ${s.id} "${s.cn}"  ${s.o.price != null ? formatPrice(s.o.price) : "–"}  /produkter/${s.o.product.slug}`
    );
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
