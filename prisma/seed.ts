/**
 * PokeFinds seed-script.
 *
 * RIKTIG DATA: sets, kort, bilder och butiker är verkliga.
 *  - Sets/kort/bilder kommer från en statisk snapshot av officiella
 *    Pokémon TCG API:t (prisma/data/real-cards.json) → seeden är
 *    deterministisk och fungerar HELT OFFLINE.
 *  - Kör `npm run import:tcg` efteråt för att hämta färsk, komplett data
 *    (fler kort, exakta rarities, aktuella marknadspriser) direkt från API:t.
 *  - Butikerna är riktiga svenska/EU-återförsäljare med riktiga URL:er.
 *    Inga priser scrapas i seeden — offers är realistiska demo-priser
 *    förankrade i verkliga marknadsnivåer. Scrape-källor per butik skapas
 *    INAKTIVA tills robots.txt/villkor verifierats (se config.robots).
 *
 * Prishistorik, användare och community-innehåll är genererad demo-data.
 */
import { PrismaClient, ProductCategory, StockStatus, CardLanguage, CardCondition, PostCategory, Role, SourceType, AlertType, AlertChannel, AlertStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

// Deterministisk pseudo-random för reproducerbar seed
let seedState = 42;
function rand(): number {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}
function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ---------- Riktig kortdata (statisk snapshot från Pokémon TCG API) ----------

interface RealDataFile {
  meta: { eurToOre: number; note: string };
  sets: { id: string; name: string; series: string; releaseDate: string; printedTotal: number; total: number }[];
  cards: [string, string, string, string, number | null][]; // [setId, number, name, rarity, marketEur]
}

const REAL_DATA: RealDataFile = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "real-cards.json"), "utf-8")
);
const EUR_TO_ORE = REAL_DATA.meta.eurToOre; // 1 EUR = 1150 öre (fast, dokumenterad kurs)

/** Riktiga bild-URL:er från images.pokemontcg.io (officiell bild-CDN för API:t). */
const cardImageUrl = (setId: string, number: string) =>
  `https://images.pokemontcg.io/${setId}/${number}_hires.png`;
const setLogoUrl = (setId: string) => `https://images.pokemontcg.io/${setId}/logo.png`;
const setSymbolUrl = (setId: string) => `https://images.pokemontcg.io/${setId}/symbol.png`;

// ---------- Riktiga återförsäljare (verifierade namn + hemsidor) ----------
// OBS: Inga priser hämtas från dessa i seeden. Scrape-källor skapas inaktiva
// tills robots.txt + användarvillkor verifierats manuellt per butik.

const ROBOTS_CHECKED_AT = "2026-06-11";

const RETAILER_DATA: {
  name: string;
  url: string;
  country: string;
  affiliate: boolean;
  robotsAllowed: boolean | null;
  robotsNote: string;
}[] = [
  { name: "Spelexperten", url: "https://www.spelexperten.com", country: "SE", affiliate: false, robotsAllowed: true, robotsNote: "robots.txt verifierad 2026-06-11: endast /cgi-bin/ibutik/admin/ och /webbadmin disallowed — produktsidor tillåtna" },
  { name: "Webhallen", url: "https://www.webhallen.com", country: "SE", affiliate: false, robotsAllowed: true, robotsNote: "robots.txt verifierad 2026-06-11: endast /se/member/ och /se/checkout disallowed — produktsidor tillåtna" },
  { name: "Alphaspel", url: "https://alphaspel.se", country: "SE", affiliate: false, robotsAllowed: true, robotsNote: "robots.txt verifierad 2026-06-11: checkout/admin/account/availability_alert disallowed — produktsidor tillåtna" },
  { name: "Spel & Sånt", url: "https://www.spelochsant.se", country: "SE", affiliate: false, robotsAllowed: null, robotsNote: "robots.txt kunde EJ hämtas 2026-06-11 (blockerar automatisk åtkomst) — verifiera manuellt innan adapter aktiveras" },
  { name: "Dragon's Lair", url: "https://www.dragonslair.se", country: "SE", affiliate: false, robotsAllowed: true, robotsNote: "robots.txt verifierad 2026-06-11: tillåter crawling (även AI-bottar, crawl-delay 10s) — endast checkout/varukorg disallowed" },
  { name: "Spelbutiken", url: "https://www.spelbutiken.se", country: "SE", affiliate: false, robotsAllowed: true, robotsNote: "robots.txt verifierad 2026-06-11: /my/, /api/, /basket/, /catalog, /checkout disallowed — OBS: /catalog disallowed, kontrollera var produktsidor ligger innan adapter" },
  { name: "Cardmarket", url: "https://www.cardmarket.com", country: "DE", affiliate: false, robotsAllowed: false, robotsNote: "Scraping otillåten enligt villkor — prisdata hämtas via officiella publika prisguiden (downloads.s3.cardmarket.com) + Pokémon TCG API:ts cardmarket-fält" },
  { name: "Tradera", url: "https://www.tradera.com", country: "SE", affiliate: false, robotsAllowed: true, robotsNote: "Publika sökresultat — inga inloggningskrav. Kategori 345149 = Pokémon samlarkort" },
];

// ---------- Riktiga butikspriser (skrapade 2026-06-11 från robots-tillåtna sidor) ----------
// Källor: spelexperten.com produktsida, dragonslair.se kategorisida (English booster).
// "Booster Display" hos butikerna = vår kategori BOOSTER_BOX.
const REAL_RETAIL_PRICES: {
  retailerName: string;
  setExternalId: string;
  category: ProductCategory;
  priceOre: number;
  inStock: boolean;
}[] = [
  { retailerName: "Spelexperten", setExternalId: "sv10", category: "BOOSTER_BOX", priceOre: 2499_00, inStock: false },
  { retailerName: "Spelexperten", setExternalId: "sv10", category: "BOOSTER_PACK", priceOre: 79_00, inStock: true },
  { retailerName: "Spelexperten", setExternalId: "sv8", category: "BOOSTER_PACK", priceOre: 70_00, inStock: true },
  { retailerName: "Spelexperten", setExternalId: "me1", category: "BOOSTER_BOX", priceOre: 2149_00, inStock: true },
  { retailerName: "Dragon's Lair", setExternalId: "me4", category: "BOOSTER_PACK", priceOre: 79_00, inStock: true },
  { retailerName: "Dragon's Lair", setExternalId: "me3", category: "BOOSTER_PACK", priceOre: 89_00, inStock: false },
];

// ---------- Sealed-produkttyper med realistiska SEK-prisspann (öre) ----------

const SEALED_TYPES: { suffix: string; category: ProductCategory; basePrice: number }[] = [
  { suffix: "Booster Box", category: "BOOSTER_BOX", basePrice: 1800_00 },
  { suffix: "Elite Trainer Box", category: "ETB", basePrice: 650_00 },
  { suffix: "Booster Pack", category: "BOOSTER_PACK", basePrice: 65_00 },
];

/** Realistisk prismultiplikator per set (eftertraktade set kostar mer). */
const SET_PRICE_MULTIPLIER: Record<string, number> = {
  swsh7: 2.8, // Evolving Skies
  sv8pt5: 2.2, // Prismatic Evolutions
  sv3pt5: 1.8, // 151
  swsh12pt5: 1.6, // Crown Zenith
  sv8: 1.3, // Surging Sparks
  swsh9: 1.4, // Brilliant Stars
  swsh11: 1.4, // Lost Origin
};

/** Demo-pris (öre) för singelkort utan känt marknadspris, baserat på rarity. */
function rarityFallbackOre(rarity: string): number {
  if (/special illustration|rainbow|secret|shiny ultra/i.test(rarity)) return randInt(400_00, 2000_00);
  if (/ultra|vmax|vstar/i.test(rarity)) return randInt(80_00, 400_00);
  if (/double rare|holo v\b/i.test(rarity)) return randInt(20_00, 80_00);
  if (/rare/i.test(rarity)) return randInt(5_00, 20_00);
  if (/uncommon/i.test(rarity)) return randInt(2_00, 6_00);
  return randInt(1_00, 3_00);
}

async function main() {
  console.log("🌱 Seedar PokeFinds (riktiga sets/kort/butiker, offline-snapshot)...");

  // Rensa i beroendeordning
  await prisma.analyticsEvent.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.scannerJob.deleteMany();
  await prisma.scrapeJob.deleteMany();
  await prisma.report.deleteMany();
  await prisma.savedPost.deleteMany();
  await prisma.like.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.communityPost.deleteMany();
  await prisma.collectionItem.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.watchlistItem.deleteMany();
  await prisma.restockEvent.deleteMany();
  await prisma.priceSnapshot.deleteMany();
  await prisma.priceObservation.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.product.deleteMany();
  await prisma.card.deleteMany();
  await prisma.cardSet.deleteMany();
  await prisma.retailer.deleteMany();
  await prisma.scrapeSource.deleteMany();
  await prisma.user.deleteMany();

  // --- Sets (riktiga, från snapshot) ---
  const setsById = new Map<string, { id: string; name: string; releaseDate: Date; printedTotal: number; externalId: string }>();
  for (const s of REAL_DATA.sets) {
    const created = await prisma.cardSet.create({
      data: {
        name: s.name,
        series: s.series,
        releaseDate: new Date(s.releaseDate),
        totalCards: s.printedTotal,
        externalId: s.id, // riktigt API-set-id (t.ex. "sv3pt5")
        logoUrl: setLogoUrl(s.id),
        symbolUrl: setSymbolUrl(s.id),
      },
    });
    setsById.set(s.id, {
      id: created.id,
      name: s.name,
      releaseDate: new Date(s.releaseDate),
      printedTotal: s.printedTotal,
      externalId: s.id,
    });
  }
  console.log(`✅ ${setsById.size} riktiga sets`);

  // --- Kort (riktiga namn, nummer och bilder) ---
  const cards: { id: string; name: string; number: string; rarity: string; setDbId: string; setExternalId: string; setName: string; printedTotal: number; marketEur: number | null; language: CardLanguage }[] = [];
  for (const [setExternalId, number, name, rarity, marketEur] of REAL_DATA.cards) {
    const set = setsById.get(setExternalId);
    if (!set) continue;
    const created = await prisma.card.create({
      data: {
        name,
        setId: set.id,
        number,
        rarity,
        language: "EN",
        supertype: "Pokémon",
        imageUrl: cardImageUrl(setExternalId, number),
        tcgExternalId: `${setExternalId}-${number}`,
      },
    });
    cards.push({
      id: created.id,
      name,
      number,
      rarity,
      setDbId: set.id,
      setExternalId,
      setName: set.name,
      printedTotal: set.printedTotal,
      marketEur,
      language: "EN",
    });
  }
  console.log(`✅ ${cards.length} riktiga kort (med bilder från images.pokemontcg.io)`);

  // --- Retailers (riktiga butiker) ---
  const retailers = [];
  for (const r of RETAILER_DATA) {
    retailers.push(await prisma.retailer.create({
      data: {
        name: r.name,
        websiteUrl: r.url,
        country: r.country,
        isActive: true,
        sourceType: "MANUAL", // ingen automatisk insamling förrän robots/villkor verifierats
        affiliateEnabled: r.affiliate,
        affiliateParams: r.affiliate ? "ref=pokefinds" : null,
      },
    }));
  }
  console.log(`✅ ${retailers.length} riktiga retailers`);

  // --- ScrapeSources ---
  // 1) Mock-källa (aktiv) för simulerad prisdrift i dev
  const mockSource = await prisma.scrapeSource.create({
    data: {
      name: "Mock-datakälla",
      baseUrl: "internal://mock",
      type: "MOCK",
      isActive: true,
      config: { interval: "hourly", note: "Genererar simulerad prisdata för utveckling" },
    },
  });
  // 2) Pokémon TCG API (aktiv) — officiellt API, ingen scraping
  await prisma.scrapeSource.create({
    data: {
      name: "Pokémon TCG API",
      baseUrl: "https://api.pokemontcg.io/v2",
      type: "API",
      isActive: true,
      config: {
        note: "Officiellt gratis API. Kör `npm run import:tcg` för full katalogimport.",
        eurToOre: EUR_TO_ORE,
        apiKeyEnv: "POKEMONTCG_API_KEY",
      },
    },
  });
  // 3) En källa per riktig butik. Adapters som är implementerade + robots-verifierade
  //    skapas som aktiva. Övriga förblir inaktiva tills adapter + robots verifierats.
  const IMPLEMENTED_ADAPTERS = new Set(["Spelexperten", "Webhallen", "Dragon's Lair", "Alphaspel", "Tradera"]);
  for (const r of RETAILER_DATA) {
    const hasAdapter = IMPLEMENTED_ADAPTERS.has(r.name);
    await prisma.scrapeSource.create({
      data: {
        name: r.name,
        baseUrl: r.url,
        type: "SCRAPER",
        isActive: hasAdapter && r.robotsAllowed === true,
        config: {
          robots: { checkedAt: r.robotsAllowed === null ? null : ROBOTS_CHECKED_AT, allowed: r.robotsAllowed, note: r.robotsNote },
          userAgent: "PokeFindsBot/1.0 (+kontakt: admin@pokefinds.se)",
          etik: "Respektera robots.txt och rate limits. Ingen captcha-/login-bypass.",
          adapterImplemented: hasAdapter,
        },
      },
    });
  }

  // --- Sealed-produkter (riktiga produktnamn per set, set-logga som bild) ---
  const products: { product: { id: string; title: string; slug: string; category: ProductCategory; language: CardLanguage }; basePrice: number; setExternalId?: string }[] = [];
  const usedSlugs = new Set<string>();
  for (const s of REAL_DATA.sets) {
    const set = setsById.get(s.id)!;
    for (const t of SEALED_TYPES) {
      const title = `Pokémon TCG: ${set.name} ${t.suffix}`;
      let slug = slugify(title);
      if (usedSlugs.has(slug)) slug = `${slug}-${s.id}`;
      usedSlugs.add(slug);
      const mult = SET_PRICE_MULTIPLIER[s.id] ?? 1;
      const basePrice = Math.round(t.basePrice * mult);
      products.push({
        product: await prisma.product.create({
          data: {
            title,
            normalizedTitle: title.toLowerCase(),
            slug,
            category: t.category,
            setId: set.id,
            language: "EN",
            releaseDate: set.releaseDate,
            imageUrl: setLogoUrl(s.id),
            description: `${t.suffix} från ${set.name} (${s.series}). Engelsk utgåva, fabriksförseglad.`,
          },
        }),
        basePrice,
        setExternalId: s.id,
      });
    }
  }

  // --- Singles-produkter från riktiga kort (marknadspris där känt) ---
  // Chase-kort (känt marknadspris) + ett urval vanliga kort
  const singlesSource = [
    ...cards.filter((c) => c.marketEur != null),
    ...cards.filter((c) => c.marketEur == null).filter((_, i) => i % 4 === 0),
  ];
  for (const card of singlesSource) {
    const title = `${card.name} · ${card.setName} ${card.number}/${card.printedTotal}`;
    let slug = slugify(`${card.name}-${card.setExternalId}-${card.number}`);
    if (usedSlugs.has(slug)) slug = `${slug}-${randInt(2, 999)}`;
    usedSlugs.add(slug);
    const basePrice = card.marketEur != null
      ? Math.round(card.marketEur * EUR_TO_ORE)
      : rarityFallbackOre(card.rarity);
    products.push({
      product: await prisma.product.create({
        data: {
          title,
          normalizedTitle: title.toLowerCase(),
          slug,
          category: "SINGLE_CARD",
          cardId: card.id,
          setId: card.setDbId,
          imageUrl: cardImageUrl(card.setExternalId, card.number),
          language: card.language,
        },
      }),
      basePrice,
    });
  }
  console.log(`✅ ${products.length} produkter (sealed + singles, riktiga bilder)`);

  // --- Offers + prishistorik + snapshots ---
  // Genererar sök-URL:er per butik → klick tar användaren till en sökning
  // på butikens sajt med produkttiteln som sökterm. Riktiga scraper-adapters
  // skriver över med exakta produktsidors URL:er vid körning.
  function retailerSearchUrl(retailerUrl: string, retailerName: string, productTitle: string): string {
    // Extrahera sökbar del: "Pokémon TCG: Surging Sparks Booster Box" → "Surging Sparks Booster Box"
    const searchTerm = productTitle.replace(/^Pokémon TCG:\s*/i, "").trim();
    const q = encodeURIComponent(searchTerm);
    switch (retailerName) {
      case "Spelexperten":
        return `${retailerUrl}/search?q=${q}`;
      case "Webhallen":
        return `${retailerUrl}/se/search?query=${q}`;
      case "Alphaspel":
        return `${retailerUrl}/search?q=${q}`;
      case "Dragon's Lair":
        return `${retailerUrl}/search?q=${q}`;
      case "Spelbutiken":
        return `${retailerUrl}/search?q=${q}`;
      case "Spel & Sånt":
        return `${retailerUrl}/search?q=${q}`;
      case "Cardmarket":
        return `${retailerUrl}/en/Pokemon/Products/Search?searchString=${q}`;
      default:
        return `${retailerUrl}/search?q=${q}`;
    }
  }
  let obsCount = 0;
  let offerCount = 0;
  const now = Date.now();
  for (const { product, basePrice, setExternalId } of products) {
    // Riktiga skrapade priser först (exakta SEK-priser, verifierad lagerstatus)
    const realEntries = setExternalId
      ? REAL_RETAIL_PRICES.filter((e) => e.setExternalId === setExternalId && e.category === product.category)
      : [];
    const realRetailerNames = new Set<string>();
    for (const entry of realEntries) {
      const retailer = retailers.find((r) => r.name === entry.retailerName);
      if (!retailer) continue;
      realRetailerNames.add(retailer.name);
      await prisma.offer.create({
        data: {
          productId: product.id,
          retailerId: retailer.id,
          url: retailerSearchUrl(retailer.websiteUrl, retailer.name, product.title),
          price: entry.priceOre,
          stockStatus: entry.inStock ? "IN_STOCK" : "OUT_OF_STOCK",
          shippingPrice: randInt(29_00, 79_00),
          condition: "SEALED",
          language: product.language,
        },
      });
      offerCount++;
    }

    // FEJKADE offers borttagna — riktiga offers skapas via skraparna
    // (npx tsx scripts/run-scrapers.ts)

    // Ingen syntetisk prishistorik genereras — riktig historik byggs av
    // importscripten (Cardmarket prisguide, Pokémon TCG API, TCGdex) och
    // skraparna. Fabricerade priser är förbjudna.
  }
  console.log(`✅ ${offerCount} offers, ${obsCount} prisobservationer`);

  // --- Restock events (50+) ---
  let restockCount = 0;
  for (let i = 0; i < 55; i++) {
    const { product, basePrice } = pick(products);
    const retailer = pick(retailers);
    await prisma.restockEvent.create({
      data: {
        productId: product.id,
        retailerId: retailer.id,
        oldStatus: "OUT_OF_STOCK",
        newStatus: "IN_STOCK",
        price: Math.round(basePrice * (1 + (rand() - 0.5) * 0.15)),
        detectedAt: new Date(now - randInt(0, 60) * 86400_000 - randInt(0, 86400_000)),
      },
    });
    restockCount++;
  }
  console.log(`✅ ${restockCount} restock events`);

  // --- Användare ---
  const adminHash = await bcrypt.hash("admin1234", 10);
  const demoHash = await bcrypt.hash("demo1234", 10);

  const admin = await prisma.user.create({
    data: {
      email: "admin@pokefinds.se",
      name: "Admin",
      passwordHash: adminHash,
      role: "SUPERADMIN",
      emailVerifiedAt: new Date(),
      onboardingCompleted: true,
    },
  });

  const firstSet = setsById.get("sv3pt5")!;
  const secondSet = setsById.get("swsh7")!;
  const demo = await prisma.user.create({
    data: {
      email: "demo@pokefinds.se",
      name: "Demo Samlare",
      passwordHash: demoHash,
      role: "USER",
      emailVerifiedAt: new Date(),
      onboardingCompleted: true,
      preferences: { interests: ["sealed", "singles"], budget: "medium", favoriteSets: [firstSet.id, secondSet.id] },
    },
  });

  const userNames = [
    "Erik Lundqvist", "Anna Bergström", "Johan Nilsson", "Maria Ek", "Oskar Lind",
    "Sara Holm", "Viktor Åberg", "Elin Sjögren", "Marcus Dahl", "Linnea Forsberg",
    "Anton Wikström", "Julia Sandberg", "Filip Norén", "Emma Hedlund", "Lucas Brandt",
    "Alva Strömberg", "Hugo Lindgren", "Stella Nyman",
  ];
  const users = [admin, demo];
  for (let i = 0; i < userNames.length; i++) {
    users.push(await prisma.user.create({
      data: {
        email: `user${i + 1}@example.com`,
        name: userNames[i],
        passwordHash: demoHash,
        role: i === 0 ? "MODERATOR" : "USER",
        emailVerifiedAt: new Date(),
        onboardingCompleted: true,
        reputationScore: randInt(0, 500),
      },
    }));
  }
  console.log(`✅ ${users.length} användare`);

  // --- Demo-användarens watchlist, samling, alerts ---
  for (const { product } of products.slice(0, 8)) {
    await prisma.watchlistItem.create({
      data: {
        userId: demo.id,
        productId: product.id,
        targetPrice: randInt(100_00, 2000_00),
        restockAlert: true,
        priceAlert: true,
      },
    });
  }
  for (const card of cards.filter((c) => c.marketEur != null).slice(0, 15)) {
    const valueOre = Math.round((card.marketEur ?? 1) * EUR_TO_ORE);
    await prisma.collectionItem.create({
      data: {
        userId: demo.id,
        cardId: card.id,
        quantity: randInt(1, 4),
        condition: pick(["MINT", "NEAR_MINT", "EXCELLENT"] as CardCondition[]),
        language: card.language,
        purchasePrice: Math.round(valueOre * (0.6 + rand() * 0.6)),
        purchaseDate: new Date(now - randInt(30, 700) * 86400_000),
        estimatedValue: valueOre,
        imageUrl: cardImageUrl(card.setExternalId, card.number),
      },
    });
  }
  for (const { product } of products.slice(0, 5)) {
    await prisma.alert.create({
      data: {
        userId: demo.id,
        productId: product.id,
        type: pick(["PRICE_DROP", "RESTOCK"] as AlertType[]),
        message: `${product.title} har ändrats — kolla in det!`,
        channel: "IN_APP",
        status: "SENT",
        sentAt: new Date(now - randInt(1, 10) * 86400_000),
      },
    });
    await prisma.notification.create({
      data: {
        userId: demo.id,
        title: "Prisalert",
        body: `${product.title} har fått ett nytt lägsta pris.`,
        linkUrl: `/produkter/${product.slug}`,
      },
    });
  }

  // --- Community posts (100+) ---
  const postTitles: [string, PostCategory][] = [
    ["Mitt bästa pull någonsin!", "PULLS"],
    ["Drog en SIR ur tredje paketet", "PULLS"],
    ["Vilken förvaring rekommenderar ni?", "QUESTIONS"],
    ["Säljer/byter dubletter från senaste setet", "TRADES"],
    ["Är priserna på väg upp igen?", "MARKET"],
    ["Ny release annonserad", "NEWS"],
    ["Min samling efter 2 års samlande", "COLLECTIONS"],
    ["Tips för att börja samla japanska kort?", "QUESTIONS"],
    ["Bytte till mig en gammal favorit idag", "TRADES"],
    ["Marknadsanalys: sealed vs singles", "MARKET"],
  ];
  const postBodies = [
    "Helt otroligt, har letat efter det här kortet i månader. Vilken känsla!",
    "Vad tycker ni — behålla eller sälja? Priserna har rört sig en del på sistone.",
    "Delar några bilder från helgens öppning. Blev riktigt nöjd med utfallet.",
    "Har följt marknaden ett tag nu och ser ett tydligt mönster. Någon annan som märkt samma sak?",
    "Första gången jag testar att grada ett kort. Spännande att se resultatet!",
    "Tips: kolla alltid skicket noga innan du köper singles. Lärde mig den hårda vägen.",
  ];
  const posts = [];
  for (let i = 0; i < 105; i++) {
    const [title, category] = pick(postTitles);
    const author = pick(users);
    posts.push(await prisma.communityPost.create({
      data: {
        userId: author.id,
        title: `${title}${i > 9 ? ` #${i}` : ""}`,
        content: pick(postBodies),
        category,
        createdAt: new Date(now - randInt(0, 90) * 86400_000 - randInt(0, 86400_000)),
      },
    }));
  }
  // Kommentarer + likes
  for (const post of posts.slice(0, 60)) {
    const numComments = randInt(0, 4);
    for (let c = 0; c < numComments; c++) {
      await prisma.comment.create({
        data: {
          postId: post.id,
          userId: pick(users).id,
          content: pick(["Grattis, najs pull!", "Snyggt kort!", "Tack för infon!", "Håller med, har sett samma trend.", "Vilket set kommer det från?"]),
        },
      });
    }
    const numLikes = randInt(0, 8);
    const likers = [...users].sort(() => rand() - 0.5).slice(0, numLikes);
    for (const liker of likers) {
      await prisma.like.create({ data: { postId: post.id, userId: liker.id } }).catch(() => {});
    }
  }
  console.log(`✅ ${posts.length} community posts`);

  // --- Scrape jobs (historik) ---
  for (let i = 0; i < 10; i++) {
    const started = new Date(now - i * 6 * 3600_000);
    await prisma.scrapeJob.create({
      data: {
        sourceId: mockSource.id,
        status: i === 1 ? "FAILED" : "COMPLETED",
        startedAt: started,
        finishedAt: new Date(started.getTime() + randInt(20_000, 180_000)),
        itemsFound: randInt(80, 140),
        itemsUpdated: randInt(20, 90),
        errorMessage: i === 1 ? "Simulerat fel: timeout mot källa" : null,
        logs: [{ ts: started.toISOString(), msg: "Jobb startat" }, { ts: started.toISOString(), msg: i === 1 ? "Fel: timeout" : "Jobb klart" }],
      },
    });
  }

  console.log("🎉 Seed klar!");
  console.log("   Admin: admin@pokefinds.se / admin1234");
  console.log("   Demo:  demo@pokefinds.se / demo1234");
  console.log("   Tips:  kör `npm run import:tcg` för full, färsk kortdata från Pokémon TCG API.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
