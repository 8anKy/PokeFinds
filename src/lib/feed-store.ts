/**
 * FLÖDETS LAGER — en JSON-fil på Railway-volymen, aldrig en databastabell.
 *
 * ⛔ SERVER ONLY. Filen rör `fs` och får aldrig importeras i en klientkomponent.
 *
 * VARFÖR VOLYMEN OCH INTE POSTGRES: se `src/lib/feed.ts`. Kort: nyhetslistan läses
 * av varje besökare, och en Neon-väckning kostar minst 300 s debiterad tid. En
 * filläsning kostar noll. Volymen (samma som ISR-cachen bor på) överlever deployer,
 * så flödet försvinner inte varje gång vi pushar.
 *
 * ⛔ SKRIVNINGEN ÄR ATOMÄR (temp + rename). En halvskriven fil hade gett en tom
 *    nyhetssida för alla tills nästa jobbkörning — och `JSON.parse` kastar mitt i
 *    en rendering, dvs 500 på hela sidan.
 * ⛔ EN SAKNAD FIL ÄR INGET FEL. Före första jobbkörningen (och i utveckling)
 *    finns ingen fil; då är flödet tomt och sidorna visar sitt tomma läge.
 */
import { promises as fs } from "fs";
import path from "path";
import { cachedRead } from "@/lib/cache";
import { EMPTY_FEED, feedDocumentSchema, normalizeFeed, type EventItem, type FeedDocument, type NewsItem } from "@/lib/feed";

/**
 * Taggen som `/api/cron/feed-publish` invaliderar när den skrivit. Sidorna är
 * ISR-cachade i en timme; utan taggen syns en ny nyhet först när TTL:en löper ut.
 * ⛔ Egen tagg — ALDRIG `PRICE_CACHE_TAG`: prisjobben tömmer den 3–4 ggr/dygn och
 *    hade då renderat om nyhetssidorna i onödan.
 */
export const FEED_CACHE_TAG = "flode";

/** Flödets katalog på volymen. Delas med nyhetsinkorgen (`feed-inbox-store.ts`). */
export function feedDir(): string {
  if (process.env.FEED_DIR) return process.env.FEED_DIR;
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "feed");
  // Utveckling: en katalog i projektet (gitignorerad), så flödet går att testa lokalt.
  return path.join(process.cwd(), ".feed-cache");
}

function feedPath(): string {
  return path.join(feedDir(), "feed.json");
}

/**
 * Processminne så en sidrendering inte parsar om JSON:en varje gång. Nyckeln är
 * filens mtime — skriver jobbet en ny fil laddas den om av sig själv, utan TTL
 * att gissa på.
 */
let cached: { mtimeMs: number; doc: FeedDocument } | null = null;

export async function readFeed(): Promise<FeedDocument> {
  const file = feedPath();
  try {
    const stat = await fs.stat(file);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.doc;
    const raw = await fs.readFile(file, "utf8");
    const parsed = feedDocumentSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.error("[feed] filen på volymen är ogiltig — visar tomt flöde:", parsed.error.issues.slice(0, 3));
      return EMPTY_FEED;
    }
    cached = { mtimeMs: stat.mtimeMs, doc: parsed.data };
    return parsed.data;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    // ENOENT = ingen körning ännu. Allt annat är värt en rad i loggen.
    if (code !== "ENOENT") console.error("[feed] kunde inte läsa flödet:", error);
    return EMPTY_FEED;
  }
}

export async function writeFeed(doc: FeedDocument): Promise<void> {
  const dir = feedDir();
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "feed.json");
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(doc), "utf8");
  await fs.rename(tmp, file);
  cached = null;
}

/**
 * Läsning för SIDORNA. `cachedRead` gör två saker här: den slipper en filläsning
 * per rendering, och — viktigare — den TAGGAR sidans cache-post med
 * `FEED_CACHE_TAG`, så `revalidateTag` i publiceringsrutten faktiskt får
 * `/nyheter` och `/evenemang` att renderas om. Utan taggen hade en ny nyhet
 * synts först när ISR-timmen löpt ut.
 *
 * ⛔ TTL:en (3600 s) måste vara minst lika lång som sidornas `revalidate` —
 *    en routes färskhet blir det LÄGSTA värdet bland alla cachade läsningar i
 *    renderingen (läxan står i src/lib/cache.ts).
 */
export const getFeed = cachedRead(readFeed, "flode", 3600, [FEED_CACHE_TAG]);

/**
 * Lägger in (eller ersätter) EN post i lane `curated` — vägen in för ett godkänt
 * utkast ur nyhetsinkorgen. ⛔ Aldrig via `feed-publish`: den rutten ersätter en
 * hel lane, och de godkända posterna finns bara här — inget jobb bygger om dem.
 * Sidorna invalideras av anroparen (`revalidateTag(FEED_CACHE_TAG)`).
 */
export async function upsertCuratedNews(item: NewsItem): Promise<FeedDocument> {
  const current = await readFeed();
  const doc = normalizeFeed({
    generatedAt: new Date().toISOString(),
    news: [item, ...current.news.filter((n) => n.id !== item.id)],
    events: current.events,
  });
  await writeFeed(doc);
  return doc;
}

/** Tar bort en post ur flödet på id (ångra ett godkännande). Okänt id är inget fel. */
export async function removeNewsById(id: string): Promise<FeedDocument> {
  const current = await readFeed();
  const doc = { ...current, news: current.news.filter((n) => n.id !== id) };
  await writeFeed(doc);
  return doc;
}

/** Som `upsertCuratedNews`, för ett godkänt evenemang. Läggs FÖRST så det vinner slug-dubblettvakten. */
export async function upsertCuratedEvent(item: EventItem): Promise<FeedDocument> {
  const current = await readFeed();
  const doc = normalizeFeed({
    generatedAt: new Date().toISOString(),
    news: current.news,
    events: [item, ...current.events.filter((e) => e.id !== item.id)],
  });
  await writeFeed(doc);
  return doc;
}

export async function removeEventById(id: string): Promise<FeedDocument> {
  const current = await readFeed();
  const doc = { ...current, events: current.events.filter((e) => e.id !== id) };
  await writeFeed(doc);
  return doc;
}
