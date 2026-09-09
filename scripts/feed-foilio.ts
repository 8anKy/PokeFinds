/**
 * FOILIO-LANEN i nyhetsflödet: nyheter ur VÅR EGEN katalog.
 *
 * ⛔ KÖRS SOM ETT STEG I `scrape-all.yml`, ALDRIG SOM EGEN CRON. Neon debiteras
 *    per vaken tid och varje väckning köper minst 300 s — nattkedjan har redan
 *    databasen vaken, så de här tre frågorna kostar noll extra. En egen cron hade
 *    kostat en väckning i dygnet för tre SELECT. (Samma regel som
 *    achievement-sweep, se CLAUDE.md.)
 *
 * VARFÖR LANEN FINNS: RSS-källorna räcker inte. Uppmätt 2026-09-09 släppte
 * relevansgrinden igenom 0 av 18 poster från de två flöden som alls svarar —
 * PokéBeach har stängt sin feed ("No feed available"), och det som finns kvar är
 * tv-spelsbloggar. Vår egen katalog vet däremot saker ingen annan svensk sajt vet:
 * vilka set som släpps, vad som är nytt hos butikerna och vad som rört sig i pris.
 *
 * ⛔ INGA PÅHITTADE NYHETER. Varje post är ett FAKTUM ur databasen med en länk in
 *    i appen där man kan kontrollera det. Ingen rubrik får påstå mer än raden bär.
 *
 *   npx tsx scripts/feed-foilio.ts --dry     # visar, skickar ingenting
 */
import { PrismaClient } from "@prisma/client";
import { feedPublishSchema, stableId, type NewsItem } from "../src/lib/feed";

const prisma = new PrismaClient();

/** Ett set som släpps inom så här många dagar räknas som "på gång". */
const UPCOMING_DAYS = 60;
/** …och ett som redan släppts ligger kvar så här länge som "nyss släppt". */
const RECENT_RELEASE_DAYS = 14;
/** Nya katalogprodukter från de senaste dygnen. */
const NEW_PRODUCT_DAYS = 3;
/** Hur många nya produkter som får bli varsin nyhet per körning. */
const MAX_NEW_PRODUCTS = 8;

const BASE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://foilio.se").replace(/\/+$/, "");

function absolute(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return url.startsWith("/") ? `${BASE_URL}${url}` : null;
}

function item(partial: Omit<NewsItem, "lane" | "internal" | "id"> & { id?: string }): NewsItem {
  return {
    id: partial.id ?? stableId(partial.url),
    internal: true,
    lane: "foilio",
    ...partial,
  } as NewsItem;
}

/**
 * SETSLÄPP. Ett set med känt releasedatum inom fönstret blir en nyhet — den enda
 * post i flödet som är intressant BÅDE före och efter datumet, så rubriken byter
 * tempus i stället för att posten byts ut.
 */
async function setReleases(now: Date): Promise<NewsItem[]> {
  const from = new Date(now.getTime() - RECENT_RELEASE_DAYS * 86_400_000);
  const to = new Date(now.getTime() + UPCOMING_DAYS * 86_400_000);
  const sets = await prisma.cardSet.findMany({
    where: { releaseDate: { gte: from, lte: to } },
    select: { id: true, name: true, releaseDate: true, logoUrl: true, totalCards: true, language: true },
    orderBy: { releaseDate: "asc" },
    take: 20,
  });

  return sets.map((set) => {
    const release = set.releaseDate as Date;
    const upcoming = release.getTime() > now.getTime();
    const dateText = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long" }).format(release);
    const cards = set.totalCards > 0 ? `${set.totalCards} kort` : null;
    return item({
      title: upcoming ? `${set.name} släpps ${dateText}` : `${set.name} har släppts`,
      summary: [
        set.language === "JP" ? "Japanskt set." : null,
        cards ? `${cards} i setet.` : null,
        upcoming ? "Butikernas priser dyker upp här allt eftersom de lägger upp produkterna." : "Priserna uppdateras dagligen.",
      ]
        .filter(Boolean)
        .join(" "),
      url: `/sets/${set.id}`,
      source: "Foilio",
      imageUrl: absolute(set.logoUrl),
      // ⛔ Publiceringsdatum = SLÄPPDATUMET för kommande set vore fel: listan
      // sorteras på publishedAt och ett set som släpps om två månader hade legat
      // överst i två månader. Nyheten är att vi VET datumet — alltså nu.
      publishedAt: (upcoming ? now : release).toISOString(),
      category: "RELEASE",
    });
  });
}

/**
 * NYTT I KATALOGEN. Auto-importen skapar produkter ur butikernas feeds (steget
 * `feed-import-run.ts` i samma kedja), så det här är i praktiken "vad har svenska
 * butiker börjat sälja sedan i går".
 *
 * ⛔ Bara produkter som har ett PRIS och inte är gömda. En produkt utan pris är
 *    inte en nyhet, den är en tom sida.
 */
async function newProducts(now: Date): Promise<NewsItem[]> {
  const since = new Date(now.getTime() - NEW_PRODUCT_DAYS * 86_400_000);
  const products = await prisma.product.findMany({
    where: {
      createdAt: { gte: since },
      hiddenAt: null,
      lowestPriceOre: { not: null },
      category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY", "OTHER"] },
    },
    select: { slug: true, title: true, imageUrl: true, lowestPriceOre: true, createdAt: true, _count: { select: { offers: true } } },
    orderBy: { createdAt: "desc" },
    take: MAX_NEW_PRODUCTS,
  });

  return products.map((product) =>
    item({
      title: `Ny i katalogen: ${product.title}`,
      summary: `Från ${Math.round((product.lowestPriceOre ?? 0) / 100)} kr hos ${product._count.offers === 1 ? "en butik" : `${product._count.offers} butiker`}.`,
      url: `/produkter/${product.slug}`,
      source: "Foilio",
      imageUrl: absolute(product.imageUrl),
      publishedAt: product.createdAt.toISOString(),
      category: "STORE",
    })
  );
}

async function main() {
  const dry = process.argv.includes("--dry");
  const now = new Date();

  const news = [...(await setReleases(now)), ...(await newProducts(now))];

  // ⛔ Lanen skickar ALDRIG `events` — evenemangen ägs av rss-jobbet
  //    (.github/feed/events.json). `null` = "rör dem inte".
  const payload = feedPublishSchema.parse({
    lane: "foilio",
    generatedAt: now.toISOString(),
    news,
    events: null,
  });

  console.log(`[feed-foilio] ${payload.news.length} nyheter ur katalogen.`);
  if (dry) {
    for (const n of payload.news) console.log(`  · [${n.category}] ${n.title} → ${n.url}`);
    console.log("[feed-foilio] --dry: skickar ingenting.");
    return;
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET saknas — flödet kan inte publiceras.");
  const res = await fetch(`${BASE_URL}/api/cron/feed-publish`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cron-secret": secret },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`publicering misslyckades: HTTP ${res.status} ${text.slice(0, 300)}`);
  console.log(`[feed-foilio] publicerat: ${text.slice(0, 200)}`);
}

main()
  .catch((error) => {
    // ⛔ Steget får INTE fälla nattkedjan. Ett uteblivet nyhetsflöde är en
    //    kosmetisk brist; ett rött steg som svalt resten av kedjan har kostat oss
    //    ett dygns katalogdata förr (project_workflow_step_starvation).
    console.error(`::warning::[feed-foilio] steget misslyckades: ${(error as Error).message}`);
  })
  .finally(() => prisma.$disconnect());
