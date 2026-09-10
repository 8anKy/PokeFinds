/**
 * ENGÅNGSSKRIPT (2026-09-10, ägarbegäran): fyll luckorna kring 30th Celebration.
 *
 *   Torrkörning: node scripts/with-prod-db.mjs npx tsx scripts/add-30th-missing-offers.ts
 *   Skriv:       APPLY=1 node scripts/with-prod-db.mjs npx tsx scripts/add-30th-missing-offers.ts
 *
 * VAD OCH VARFÖR — tre olika orsaker till att raderna saknas, alla verifierade:
 *
 * 1. "30th Celebration Binder Collection" (CM idProduct 895560) finns INTE i katalogen.
 *    Orsak: `isAccessoryListing()` klassar pärm/portfolio som tillbehör även MED boosters
 *    (ägarbeslut 2026-08-08), så både CM-importen och butiksimporten avvisar den.
 *    ⛔ VAKTEN RÖRS INTE. Ägaren har bett om just den här produkten; den skapas explicit
 *    här, och därefter binder butiks-URL:erna via memo-/offer-ägar-vakterna i
 *    `ensureListingProduct`, som båda ligger FÖRE tillbehörsvakten. Ändrar man i stället
 *    `isAccessoryListing` släpper man in varenda pärm i hela katalogen.
 *
 * 2. MaxGamings "2-Pack Blister" saknade karaktärsnamn i titeln ⇒ "karaktärslös
 *    blister"-vakten vägrar SKAPA en produkt (karaktären ÄR identiteten) och den kunde
 *    inte matcha "Eevee 2-Pack Blister" på titel. Butikens egen produktbeskrivning säger
 *    "exklusiv foil promo-kort med Eevee" — identiteten är alltså bevisad, inte gissad.
 *
 * 3. Swepokes fyra URL:er ligger utanför butikens roterande feed, så importen har aldrig
 *    sett dem. ⛔ URL:en "…-binder-collection" visar en sida som HETER "Pokemon 30th
 *    Aniversary Poster Collection" (329 kr) — slugen ljuger, sidans namn vinner.
 *    De läggs också som `WatchedListing` så de hålls färska (feeden nämner dem inte).
 *
 * Priserna nedan är AVLÄSTA på butikens egen produktsida 2026-09-10; alla fyra Swepoke-
 * annonser stod "Slutsåld", båda MaxGaming-annonserna slut i lager. Nästa skanning
 * skriver över dem med butikens egna svar — raderna finns här bara för att första
 * skrivningen inte ska vara tom.
 */
import "./load-env";
import { prisma } from "../src/lib/db";
import { getRatesOre } from "../src/lib/exchange-rate";
import { cardmarketProductUrl, isDirectOfferUrl } from "../src/lib/marketplace-urls";
import { normalizeTitle, slugify } from "../src/lib/utils";
import { listingCardLanguage } from "../src/lib/listing-language";

const APPLY = process.env.APPLY === "1";
const GUIDE_URL = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
const BINDER_CM_ID = 895560;
const BINDER_TITLE = "30th Celebration Binder Collection";

/** Butiks-URL -> katalogprodukt (slug). Titeln är butikens EGEN, som den står på sidan. */
const LINKS: { store: string; url: string; title: string; slug: string; priceOre: number }[] = [
  {
    store: "MaxGaming",
    url: "https://www.maxgaming.se/sv/pokemon/pokemon-30th-celebration-2-pack-blister",
    title: "Pokémon 30th Celebration - 2-Pack Blister",
    slug: "30th-celebration-eevee-2-pack-blister",
    priceOre: 17900,
  },
  {
    store: "MaxGaming",
    url: "https://www.maxgaming.se/sv/pokemon/pokemon-30th-celebration-binder-collection",
    title: "Pokémon 30th Celebration - Binder Collection",
    slug: "__BINDER__",
    priceOre: 64900,
  },
  {
    store: "Swepoke",
    url: "https://www.swepoke.se/alla-produkter/pokemon-30th-aniversary-elite-trainer-box",
    title: "Pokemon 30th Aniversary Elite Trainer Box",
    slug: "30th-celebration-elite-trainer-box",
    priceOre: 84900,
  },
  {
    store: "Swepoke",
    url: "https://www.swepoke.se/alla-produkter/pokemon-30th-aniversary-binder-collection",
    title: "Pokemon 30th Aniversary Poster Collection",
    slug: "30th-celebration-poster-collection",
    priceOre: 32900,
  },
  {
    store: "Swepoke",
    url: "https://www.swepoke.se/alla-produkter/pokemon-30th-aniversary-greninja-ex-collection",
    title: "Pokemon 30th Aniversary Greninja Ex Collection",
    slug: "30th-celebration-greninja-ex-box",
    priceOre: 37900,
  },
  {
    store: "Swepoke",
    url: "https://www.swepoke.se/alla-produkter/pokemon-30th-aniversary-sylveon-ex-collection",
    title: "Pokemon 30th Aniversary Sylveon Ex Collection",
    slug: "30th-celebration-sylveon-ex-box",
    priceOre: 37900,
  },
];

// En sealed-produkt kostar aldrig under ~0,5 € — samma golv mot korrupta guide-värden
// som import-sealed-from-cardmarket.ts och cardmarket-refresh.ts använder.
const MIN_SEALED_EUR = 0.5;
const usable = (n: unknown): number | null =>
  typeof n === "number" && n >= MIN_SEALED_EUR ? n : null;

async function ensureBinderProduct(): Promise<string | null> {
  const existing = await prisma.product.findFirst({
    where: { normalizedTitle: normalizeTitle(BINDER_TITLE), language: "EN" },
    select: { id: true, slug: true },
  });
  if (existing) {
    console.log(`  [binder] finns redan: ${existing.slug}`);
    return existing.id;
  }
  // Pris ur CM:s GRATIS prisguide — samma ordning som gratis-katalog-fallbacken i
  // import-sealed-from-cardmarket.ts (low -> trend -> avg). Kostar noll RapidAPI-kvot.
  const res = await fetch(GUIDE_URL);
  const json = (await res.json()) as { priceGuides?: unknown[] } | unknown[];
  const rows = (Array.isArray(json) ? json : (json.priceGuides ?? [])) as Record<string, unknown>[];
  const g = rows.find((r) => r.idProduct === BINDER_CM_ID);
  const low = usable(g?.low);
  const eur = low ?? usable(g?.trend) ?? usable(g?.avg);
  if (eur == null) {
    console.log(`  [binder] ⛔ ingen prisdata hos CM för idProduct=${BINDER_CM_ID} — skapar inget (ett tomt skal är värdelöst).`);
    return null;
  }
  const rates = await getRatesOre();
  const priceOre = Math.round(eur * rates.eurToOre);
  if (priceOre <= 0) {
    console.log("  [binder] ⛔ priset avrundas till 0 öre — 0 kr är inget pris.");
    return null;
  }
  // Set-etiketten tas ur ett syskon i SAMMA CM-expansion (6601) som vi redan äger.
  const sibling = await prisma.product.findUnique({
    where: { slug: "30th-celebration-elite-trainer-box" },
    select: { setId: true },
  });
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) throw new Error("Cardmarket-retailer saknas");
  console.log(
    `  [binder] SKAPAR "${BINDER_TITLE}" · COLLECTION_BOX · ${eur} € = ${priceOre} öre · set=${sibling?.setId ?? "SAKNAS"}`
  );
  if (!APPLY) return null;
  const p = await prisma.product.create({
    data: {
      title: BINDER_TITLE,
      normalizedTitle: normalizeTitle(BINDER_TITLE),
      slug: slugify(BINDER_TITLE),
      category: "COLLECTION_BOX",
      setId: sibling?.setId ?? null,
      language: "EN",
      offers: {
        create: {
          retailerId: cm.id,
          condition: "SEALED",
          language: "EN",
          price: priceOre,
          currency: "SEK",
          stockStatus: low != null ? "IN_STOCK" : "OUT_OF_STOCK",
          url: cardmarketProductUrl(BINDER_CM_ID),
        },
      },
    },
    select: { id: true },
  });
  return p.id;
}

async function main() {
  console.log(APPLY ? "APPLY — skriver till PROD" : "TORRKÖRNING (APPLY=1 för att skriva)");
  const binderId = await ensureBinderProduct();

  for (const l of LINKS) {
    const slug = l.slug === "__BINDER__" ? null : l.slug;
    const productId = slug
      ? ((await prisma.product.findUnique({ where: { slug }, select: { id: true } }))?.id ?? null)
      : binderId;
    if (!productId) {
      console.log(`  ⛔ ${l.store}: ingen produkt för ${l.slug} — hoppar ${l.url}`);
      continue;
    }
    if (!isDirectOfferUrl(l.url)) {
      console.log(`  ⛔ ${l.store}: ${l.url} är ingen direktlänk — hoppar`);
      continue;
    }
    const retailer = await prisma.retailer.findFirst({ where: { name: l.store }, select: { id: true } });
    if (!retailer) {
      console.log(`  ⛔ butik saknas: ${l.store}`);
      continue;
    }
    const clash = await prisma.offer.findFirst({
      where: { retailerId: retailer.id, url: l.url },
      select: { productId: true, product: { select: { title: true } } },
    });
    if (clash && clash.productId !== productId) {
      console.log(`  ⛔ ${l.store}: URL:en ägs redan av "${clash.product.title}" — rör den inte`);
      continue;
    }
    // Samma nyckel och samma försiktighet som `upsertListingOffer` i runner.ts:
    // (produkt, butik, SEALED, annonsens språk), och en befintlig offer får ALDRIG
    // få sin URL kapad — butiken kan äga produkten via en annan variantsida.
    const offerLanguage = listingCardLanguage(l.title, l.url);
    const existingOffer = await prisma.offer.findFirst({
      where: { productId, retailerId: retailer.id, condition: "SEALED", language: offerLanguage },
      select: { id: true, url: true },
    });
    if (existingOffer && existingOffer.url !== l.url) {
      console.log(`  ⛔ ${l.store} har redan en offer på produkten (${existingOffer.url}) — kapar den inte`);
      continue;
    }
    console.log(`  [offer] ${l.store} → ${slug ?? BINDER_TITLE} · ${l.priceOre} öre · OUT_OF_STOCK · ${offerLanguage}`);
    if (!APPLY) continue;
    if (existingOffer) {
      await prisma.offer.update({
        where: { id: existingOffer.id },
        data: { price: l.priceOre, stockStatus: "OUT_OF_STOCK", lastSeenAt: new Date() },
      });
    } else {
      await prisma.offer.create({
        data: {
          productId,
          retailerId: retailer.id,
          condition: "SEALED",
          language: offerLanguage,
          price: l.priceOre,
          currency: "SEK",
          stockStatus: "OUT_OF_STOCK",
          url: l.url,
        },
      });
    }
    // Huvudboksraden = memot. Utan den döms URL:en om vid varje körning och faller på
    // tillbehörs-/karaktärsvakten igen.
    await prisma.storeListing.upsert({
      where: { retailerId_url: { retailerId: retailer.id, url: l.url } },
      create: {
        retailerId: retailer.id,
        url: l.url,
        title: l.title,
        price: l.priceOre,
        stockStatus: "OUT_OF_STOCK",
        productId,
        productMatchTitle: l.title,
      },
      update: { productId, productMatchTitle: l.title, title: l.title },
    });
    // Swepokes feed roterar och nämner aldrig de här URL:erna → bevaka dem direkt.
    if (l.store === "Swepoke") {
      await prisma.watchedListing.upsert({
        where: { retailerId_url: { retailerId: retailer.id, url: l.url } },
        create: {
          retailerId: retailer.id,
          url: l.url,
          note: "30th Celebration — utanför den roterande feeden (2026-09-10)",
        },
        update: {},
      });
    }
  }
  console.log("Klart.");
}

main().finally(() => prisma.$disconnect());
