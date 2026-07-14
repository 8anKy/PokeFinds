/**
 * RÄTTAR FELPEKANDE CM-LÄNKAR. En sealed-produkt vars CM-offer pekar på ett idProduct
 * som är NÅGON ANNAN vara (eller inte finns alls) visar en FRÄMMANDE prisgraf och ett
 * främmande pris. Mätt 2026-07-14: "Meowth VMAX Special Collection" pekade på CM:s
 * "Pitch Black: Tyrantrum Premium Checklane Blister" och stod i +372% på marknadssidan.
 *
 * SKILJ FRÅN scripts/fix-cm-idproduct-collisions.ts: den löser att TVÅ av våra produkter
 * äger SAMMA idProduct. Den här löser att EN produkt äger FEL idProduct.
 *
 * FACIT = Cardmarkets EGEN katalog (products_nonsingles_6.json). Gratis, ingen RapidAPI-
 * kvot, ingen skrapning. Vi gissar inte vad ett idProduct är — vi frågar källan.
 *
 * TVÅ FEL SOM RÄTTAS:
 *   DEAD     — idProduct finns inte i CM:s katalog alls (död/påhittad länk).
 *   MISMATCH — idProduct finns, men CM:s namn är en annan vara än vår titel.
 *
 * ATT LÄMNA EN FELLÄNK ÄR VÄRRE ÄN ATT LÄMNA EN TOM. Men att BYTA till en ny fel länk är
 * värst av allt — därför får en ersättare bara sättas när den är otvetydig:
 *   1. ingen tvåsidig vakt får säga att titlarna är olika varor (productsConflict m.fl.)
 *   2. FORMEN måste stämma (en pack är aldrig en box)
 *   3. poäng >= MIN_SCORE
 *   4. kandidatens idProduct får inte redan ÄGAS av en annan av våra produkter
 * Hittas ingen sådan → länken RENSAS (offer raderas). En produkt utan graf är alltid
 * bättre än en med FEL graf.
 *
 * Kör:  node scripts/with-prod-db.mjs npx tsx scripts/fix-cm-idproduct-mismatches.ts
 *       node scripts/with-prod-db.mjs npx tsx scripts/fix-cm-idproduct-mismatches.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import {
  scoreSimilarity, classifyForm, productsConflict, mutualIdentityConflict,
  seriesMismatch, characterMismatch, setCodeMismatch, cardCountMismatch,
  regionVersionMismatch, blisterMismatch, unitCountMismatch, yearMismatch,
  pokemonCenterMismatch, ultraPremiumMismatch, setMarkerMismatch,
} from "../src/scrapers/matching";
import { cardmarketProductUrl } from "../src/lib/marketplace-urls";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const NONSINGLES =
  "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";

// En felmatchning kostar en främmande prisgraf; en utebliven matchning kostar bara en
// tom graf. Tröskeln är därför HÖG med flit.
const MIN_SCORE = 0.72;
// Under detta anses vår titel och CM:s namn vara olika varor.
const MISMATCH_BELOW = 0.45;
// En VAKT-träff ensam räcker INTE för att döma ut en länk — bara i kombination med ett
// medelmåttigt namn. Torrkörningen 2026-07-14 visade varför:
//   "Shrouded Fable Booster Bundle Version 2" → CM 770955
//   CM:s EGET namn: "Shrouded Fable Booster Bundle Pokémon Center Version"  (poäng 0,83)
// pokemonCenterMismatch slog på ordvalet ("Version 2" vs "Pokémon Center Version") — men
// länken är KORREKT och avsiktlig: CM har 770954 = "Version 1" och 770955 = PC-versionen,
// och våra två rader mappar precis på dem. Att rensa den hade förstört en riktig graf.
// Vakterna är byggda för att jämföra BUTIKSTITLAR mot varandra, inte vår titel mot CM:s
// egen produktnamngivning — där är variantetiketter normala.
const GUARD_CONDEMNS_BELOW = 0.7;

const SEALED = ["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "COLLECTION_BOX", "TIN", "BLISTER", "BUNDLE", "OTHER"] as const;

/** Vår kategori → CM:s egna kategorinamn. En pack får aldrig länkas till en display. */
const CM_CATEGORIES: Record<string, string[]> = {
  BOOSTER_PACK: ["Pokémon Booster"],
  BOOSTER_BOX: ["Pokémon Display"],
  ETB: ["Pokémon Elite Trainer Boxes"],
  TIN: ["Pokémon Tins"],
  COLLECTION_BOX: ["Pokémon Box Set"],
  BUNDLE: ["Pokémon Box Set", "Pokémon Display"],
  BLISTER: ["Pokémon Blisters", "Pokémon Booster"],
  OTHER: ["Pokémon Box Set", "Pokémon Tins", "Pokémon Blisters", "Pokémon Booster", "Pokémon Display"],
};

const GUARDS: [string, (a: string, b: string) => boolean][] = [
  ["productsConflict", productsConflict], ["mutualIdentityConflict", mutualIdentityConflict],
  ["seriesMismatch", seriesMismatch], ["characterMismatch", characterMismatch],
  ["setCodeMismatch", setCodeMismatch], ["cardCountMismatch", cardCountMismatch],
  ["regionVersionMismatch", regionVersionMismatch], ["blisterMismatch", blisterMismatch],
  ["unitCountMismatch", unitCountMismatch], ["yearMismatch", yearMismatch],
  ["pokemonCenterMismatch", pokemonCenterMismatch], ["ultraPremiumMismatch", ultraPremiumMismatch],
  ["setMarkerMismatch", setMarkerMismatch],
];
const blockers = (a: string, b: string) =>
  GUARDS.filter(([, fn]) => { try { return fn(a, b); } catch { return false; } }).map(([n]) => n);

interface CmProd { idProduct: number; name: string; categoryName: string; }

async function main() {
  console.log(APPLY ? "APPLY — skriver.\n" : "DRY-RUN — inget skrivs. Kör med --apply.\n");

  const res = await fetch(NONSINGLES);
  if (!res.ok) throw new Error(`CM-katalogen HTTP ${res.status} — avbryter hellre än att gissa.`);
  const catalog = (await res.json()) as { products: CmProd[] };
  const byId = new Map(catalog.products.map((p) => [p.idProduct, p]));
  console.log(`CM-katalog: ${byId.size} non-single-produkter (facit).\n`);

  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  const products = await prisma.product.findMany({
    where: { category: { in: [...SEALED] } },
    select: {
      id: true, title: true, category: true, language: true,
      offers: { where: { retailerId: cm!.id }, select: { id: true, url: true, price: true } },
    },
  });

  // Vem äger vad IDAG — en kandidat som redan ägs av någon annan är per definition fel.
  const owned = new Map<number, string>();
  for (const p of products) {
    const id = Number(p.offers[0]?.url?.match(/idProduct=(\d+)/)?.[1] ?? 0);
    if (id) owned.set(id, p.id);
  }

  type Bad = { p: (typeof products)[number]; id: number; kind: "DEAD" | "MISMATCH"; cmName: string | null; score: number | null };
  const bad: Bad[] = [];

  for (const p of products) {
    const offer = p.offers[0];
    const id = Number(offer?.url?.match(/idProduct=(\d+)/)?.[1] ?? 0);
    if (!offer || !id) continue;
    if (p.language !== "EN") continue; // JP mappas av runJapaneseSealedRefresh

    const cmProd = byId.get(id);
    if (!cmProd) { bad.push({ p, id, kind: "DEAD", cmName: null, score: null }); continue; }
    const score = scoreSimilarity(p.title, cmProd.name);
    const blocked = blockers(p.title, cmProd.name);
    // Dömd = namnet är uppenbart en annan vara, ELLER en vakt slog OCH namnet är svagt.
    // En vakt-träff på ett STARKT namn (>=0.7) är en variantetikett, inte en felmatch.
    if (score < MISMATCH_BELOW || (blocked.length > 0 && score < GUARD_CONDEMNS_BELOW)) {
      bad.push({ p, id, kind: "MISMATCH", cmName: cmProd.name, score });
    }
  }

  console.log(`${bad.length} felpekande CM-länkar (${bad.filter((b) => b.kind === "DEAD").length} DEAD, ${bad.filter((b) => b.kind === "MISMATCH").length} MISMATCH)\n`);

  let repointed = 0, cleared = 0;

  for (const b of bad) {
    const allowed = CM_CATEGORIES[b.p.category] ?? [];
    const ourForm = classifyForm(b.p.title);

    const best = catalog.products
      .filter((c) => allowed.length === 0 || allowed.includes(c.categoryName))
      .filter((c) => !owned.has(c.idProduct) || owned.get(c.idProduct) === b.p.id)
      .map((c) => ({ c, score: scoreSimilarity(b.p.title, c.name) }))
      .filter((x) => x.score >= MIN_SCORE)
      .filter((x) => blockers(b.p.title, x.c.name).length === 0)
      .filter((x) => {
        const f = classifyForm(x.c.name);
        return !ourForm || !f || ourForm === f; // formen måste stämma
      })
      .sort((x, y) => y.score - x.score)[0];

    console.log(`[${b.kind}] ${b.p.title}`);
    console.log(`    nu:  idProduct=${b.id}${b.cmName ? ` → CM: "${b.cmName}"` : "  (finns INTE i CM:s katalog)"}${b.score != null ? `  (poäng ${b.score.toFixed(2)})` : ""}`);

    if (best) {
      console.log(`    ny:  idProduct=${best.c.idProduct} → CM: "${best.c.name}"  (poäng ${best.score.toFixed(2)}, ${best.c.categoryName})`);
      repointed++;
      if (APPLY) {
        await prisma.offer.update({
          where: { id: b.p.offers[0].id },
          // Priset NOLLAS: det gamla var det felaktiga produktens. Nästa
          // cardmarket-refresh fyller i rätt pris för rätt idProduct.
          data: { url: cardmarketProductUrl(best.c.idProduct), price: null, stockStatus: "UNKNOWN" },
        });
        owned.set(best.c.idProduct, b.p.id);
      }
    } else {
      console.log(`    ny:  (ingen otvetydig kandidat) → LÄNKEN RENSAS. En produkt utan graf är bättre än en med FEL graf.`);
      cleared++;
      if (APPLY) await prisma.offer.delete({ where: { id: b.p.offers[0].id } });
    }
    console.log("");
  }

  console.log(`${repointed} länkar pekas om, ${cleared} rensas.`);
  if (!APPLY) console.log("\nDry-run. Kör med --apply.");
  else console.log("Nästa cardmarket-refresh fyller i rätt pris + historik för de ompekade.");
}
main().finally(() => prisma.$disconnect());
