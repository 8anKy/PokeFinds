/**
 * BYGGER NYHETS- OCH EVENEMANGSFLÖDET och skickar det till appen.
 *
 * Körs av `.github/workflows/news-feed.yml`. ⛔ JOBBET ÄR DB-FRITT — det har ingen
 * DATABASE_URL och ska aldrig få en. Hela poängen med flödet är att det inte
 * väcker Neon: varken när det byggs eller när det läses (se src/lib/feed.ts).
 *
 *   npx tsx scripts/feed-build.ts --dry     # hämtar och visar, skickar ingenting
 *   npx tsx scripts/feed-build.ts           # skickar till APP_URL med CRON_SECRET
 *
 * ⛔ EN TRASIG KÄLLA FÄLLER INTE KÖRNINGEN. Flöden går ned, byter URL och svarar
 *    500 titt som tätt; att låta det tömma nyhetssidan vore att byta ett litet
 *    problem mot ett stort. Källan varnas om och hoppas över.
 * ⛔ VI SPARAR ALDRIG ARTIKELTEXT. Rubrik, en klippt ingress, källans namn och
 *    länken — inget mer. Bilden hotlänkas, den laddas aldrig ned.
 */
import { readFile } from "fs/promises";
import path from "path";
import {
  clampSummary,
  eventItemSchema,
  feedPublishSchema,
  inferNewsCategory,
  isTcgRelevant,
  newsItemSchema,
  type EventItem,
  slugify,
  stableId,
  type NewsCategory,
  type NewsItem,
} from "../src/lib/feed";
import { feedDraftSchema, feedEventDraftSchema, inboxFileSchema, inboxPublishSchema, type FeedDraft, type FeedEventDraft } from "../src/lib/feed-inbox";
import { extractOgImage, parseFeed } from "../src/lib/rss";

const UA = "FoilioBot/1.0 (+https://foilio.se; nyhetsflode)";
const FETCH_TIMEOUT_MS = 20_000;
/** Hur gammal en post får vara för att komma med. Ett flöde med 200 poster ska
 *  inte fylla listan med sommarens nyheter första gången vi läser det. */
const MAX_AGE_DAYS = 30;

interface Source {
  id: string;
  name: string;
  url: string;
  category: NewsCategory;
  limit?: number;
  requireRelevance?: boolean;
}

const ACCEPT_FEED = "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5";
/**
 * ⛔ EN ARTIKELSIDA MÅSTE BEGÄRAS SOM HTML. Med flödets Accept-huvud svarade
 *    psacard.com **403** — servern såg en klient som bad om XML på en HTML-sida.
 *    Det såg ut som blockering men var vårt eget huvud.
 */
const ACCEPT_PAGE = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

async function fetchText(url: string, accept = ACCEPT_FEED): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hämtar artikelsidans egen delningsbild för poster som saknar omslag.
 *
 * ⛔ EN hämtning per post och körning, och bara för EXTERNA poster utan bild —
 *    interna poster pekar på våra egna sidor och har sin bild i `public/`.
 *    Misslyckas hämtningen blir omslaget den tonade plattan; ett trasigt omslag
 *    får aldrig fälla jobbet.
 */
async function fillMissingCovers(items: NewsItem[]): Promise<void> {
  for (const item of items) {
    if (item.imageUrl || item.internal || !/^https?:\/\//i.test(item.url)) continue;
    try {
      const html = await fetchText(item.url, ACCEPT_PAGE);
      const image = extractOgImage(html, item.url);
      if (image) item.imageUrl = image;
      else console.warn(`::warning::[feed] ingen og:image på ${item.url}`);
    } catch (error) {
      console.warn(`::warning::[feed] kunde inte läsa omslag från ${item.url} — ${(error as Error).message}`);
    }
  }
}

/**
 * Evenemangens affischer. Arrangörens biljettsida bär nästan alltid nyckelbilden
 * som `og:image` — Tickster serverar den i 960×540, alltså exakt ett omslag.
 * ⛔ Biljettsidan FÖRST, info-sidan sedan: biljettsidan visar DET HÄR evenemangets
 *    affisch, medan arrangörens startsida ofta visar deras logotyp eller nästa
 *    evenemang.
 */
async function fillEventCovers(events: EventItem[]): Promise<void> {
  for (const event of events) {
    if (event.imageUrl) continue;
    const page = event.ticketUrl ?? event.infoUrl;
    if (!page) continue;
    try {
      const html = await fetchText(page, ACCEPT_PAGE);
      const image = extractOgImage(html, page);
      if (image) event.imageUrl = image;
      else console.warn(`::warning::[feed] ingen affisch på ${page}`);
    } catch (error) {
      console.warn(`::warning::[feed] kunde inte läsa affisch från ${page} — ${(error as Error).message}`);
    }
  }
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

/** Ett utkast äldre än så här får inget omslag hämtat av oss längre — rutinen hade sin chans. */
const DRAFT_COVER_MAX_AGE_DAYS = 3;

/**
 * NYHETSINKORGEN: utkasten den dagliga AI-rutinen pushat till `inbox.json` skickas
 * till `/api/cron/feed-inbox`, där ägaren godkänner dem i admin. ⛔ De publiceras
 * INTE här och går inte in i rss-lanen — se src/lib/feed-inbox.ts.
 * Ett felskrivet utkast varnas om och hoppas över, som de kurerade posterna.
 */
async function collectDrafts(dir: string, dry: boolean): Promise<{ drafts: FeedDraft[]; events: FeedEventDraft[] }> {
  const empty = { drafts: [], events: [] };
  let raw: unknown;
  try {
    raw = await readJson<unknown>(path.join(dir, "inbox.json"));
  } catch (error) {
    console.warn(`::warning::[feed] inbox.json kunde inte läsas — ${(error as Error).message}`);
    return empty;
  }
  const file = inboxFileSchema.safeParse(raw);
  if (!file.success) {
    console.warn(`::warning::[feed] inbox.json har fel form: ${file.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    return empty;
  }
  const drafts: FeedDraft[] = [];
  for (const entry of file.data.drafts) {
    const parsed = feedDraftSchema.safeParse(entry);
    if (!parsed.success) {
      console.warn(`::warning::[feed] utkast hoppades över: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      continue;
    }
    drafts.push(parsed.data);
  }

  // Omslag för FÄRSKA utkast utan bild — samma og:image-grepp som nyheterna, men
  // bara några dagar: jobbet kör 3 ggr/dygn och ett utkast ligger kvar i 30.
  const cutoff = Date.now() - DRAFT_COVER_MAX_AGE_DAYS * 86_400_000;
  for (const draft of drafts) {
    if (draft.imageUrl || Date.parse(draft.foundAt) < cutoff) continue;
    try {
      const image = extractOgImage(await fetchText(draft.url, ACCEPT_PAGE), draft.url);
      if (image) draft.imageUrl = image;
    } catch (error) {
      console.warn(`::warning::[feed] inget omslag för utkastet ${draft.url} — ${(error as Error).message}`);
    }
  }

  // Evenemangsutkasten: samma validering; affischen ur biljett-/infosidan som för events.json.
  const events: FeedEventDraft[] = [];
  for (const entry of file.data.eventDrafts) {
    const parsed = feedEventDraftSchema.safeParse(entry);
    if (!parsed.success) {
      console.warn(`::warning::[feed] evenemangsutkast hoppades över: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      continue;
    }
    events.push(parsed.data);
  }
  for (const ev of events) {
    if (ev.imageUrl || Date.parse(ev.foundAt) < cutoff) continue;
    const page = ev.ticketUrl ?? ev.infoUrl;
    if (!page) continue;
    try {
      const image = extractOgImage(await fetchText(page, ACCEPT_PAGE), page);
      if (image) ev.imageUrl = image;
    } catch (error) {
      console.warn(`::warning::[feed] ingen affisch för utkastet ${page} — ${(error as Error).message}`);
    }
  }

  console.log(`[feed] inkorg: ${drafts.length} nyhetsutkast + ${events.length} evenemangsutkast i inbox.json.`);
  if (dry) {
    for (const d of drafts) console.log(`        · [${d.category}/${d.origin}] ${d.title}`);
    for (const e of events) console.log(`        · [${e.category}] ${e.title} ${e.startsAt.slice(0, 10)} ${e.city ?? ""}`);
  }
  return { drafts, events };
}

async function collectNews(sources: Source[], dry: boolean): Promise<NewsItem[]> {
  const out: NewsItem[] = [];
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;

  for (const source of sources) {
    let xml: string;
    try {
      xml = await fetchText(source.url);
    } catch (error) {
      console.warn(`::warning::[feed] ${source.id}: kunde inte hämta ${source.url} — ${(error as Error).message}`);
      continue;
    }

    const entries = parseFeed(xml, source.limit ?? 25);
    let kept = 0;
    for (const entry of entries) {
      const published = entry.publishedAt ? Date.parse(entry.publishedAt) : NaN;
      if (Number.isNaN(published) || published < cutoff) continue;
      if (source.requireRelevance !== false && !isTcgRelevant(entry.title, entry.summary)) continue;

      out.push({
        id: stableId(entry.link),
        title: entry.title,
        summary: clampSummary(entry.summary),
        url: entry.link,
        source: source.name,
        imageUrl: entry.imageUrl,
        publishedAt: new Date(published).toISOString(),
        category: inferNewsCategory(source.category, entry.title, entry.summary),
        imageFit: "cover",
        internal: false,
        slug: null,
        body: [],
        lane: "rss",
      });
      kept++;
    }
    console.log(`[feed] ${source.id}: ${entries.length} poster i flödet, ${kept} relevanta.`);
    // ⛔ `slice(-0)` är HELA listan — därför den explicita nollkollen.
    if (dry && kept > 0) for (const item of out.slice(-kept)) console.log(`        · [${item.category}] ${item.title}`);
  }
  return out;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const dir = path.join(process.cwd(), ".github", "feed");

  const { sources } = await readJson<{ sources: Source[] }>(path.join(dir, "sources.json"));
  const { events: rawEvents } = await readJson<{ events: unknown[] }>(path.join(dir, "events.json"));
  const { news: rawCurated } = await readJson<{ news: unknown[] }>(path.join(dir, "news.json"));

  // KURERADE POSTER FÖRST i listan (marknadsnyheter och "nytt i Foilio"). De
  // sorteras ändå på publishedAt i `normalizeFeed` — ordningen här spelar bara
  // roll för dubblettvakten, och en handskriven post ska vinna över en
  // maskinhämtad med samma id.
  // ⛔ En felskriven post ska SÄGA IFRÅN, inte försvinna tyst.
  const curated: NewsItem[] = [];
  for (const raw of rawCurated) {
    const source = raw as { url?: string };
    const parsed = newsItemSchema.safeParse({ id: stableId(source.url ?? JSON.stringify(raw)), ...(raw as object), lane: "rss" });
    if (!parsed.success) {
      console.warn(`::warning::[feed] kurerad nyhet hoppades över: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      continue;
    }
    curated.push(parsed.data);
  }
  console.log(`[feed] kurerade poster: ${curated.length}.`);
  if (dry) for (const n of curated) console.log(`        · [${n.category}] ${n.title}`);

  const news = [...curated, ...(await collectNews(sources, dry))];
  await fillMissingCovers(news);
  console.log(`[feed] omslag: ${news.filter((n) => n.imageUrl).length} av ${news.length} har bild.`);

  // ⛔ Ett felskrivet evenemang ska SÄGA IFRÅN, inte försvinna tyst. Jobbet
  // fortsätter med de övriga, men raden syns som en varning på körningen.
  const events = [];
  for (const raw of rawEvents) {
    const source = raw as { title?: string; slug?: string; startsAt?: string };
    // Slug är valfri i filen: den härleds ur rubriken när den saknas, så den som
    // lägger in ett evenemang inte behöver hitta på en URL-del.
    const slug = source.slug || (source.title ? slugify(source.title) : "");
    const parsed = eventItemSchema.safeParse({
      id: stableId(`${slug}|${source.startsAt ?? ""}`),
      ...(raw as object),
      slug,
    });
    if (!parsed.success) {
      console.warn(`::warning::[feed] evenemang hoppades över: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      continue;
    }
    events.push(parsed.data);
  }

  // ⛔ Skickas som lane "rss": rutten behåller nattkedjans egna poster (lane
  //    "foilio"). Evenemangen ÄGS av det här jobbet — de kommer ur filen här.
  await fillEventCovers(events);
  console.log(`[feed] affischer: ${events.filter((e) => e.imageUrl).length} av ${events.length} evenemang har bild.`);

  const payload = feedPublishSchema.parse({
    lane: "rss",
    generatedAt: new Date().toISOString(),
    news,
    events,
  });
  console.log(`[feed] rss-lane: ${payload.news.length} nyheter, ${payload.events?.length ?? 0} evenemang.`);

  const inbox = inboxPublishSchema.parse({ generatedAt: payload.generatedAt, ...(await collectDrafts(dir, dry)) });

  if (dry) {
    console.log("[feed] --dry: skickar ingenting.");
    return;
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://foilio.se").replace(/\/+$/, "");
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET saknas — flödet kan inte publiceras.");

  const res = await fetch(`${appUrl}/api/cron/feed-publish`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cron-secret": secret },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`publicering misslyckades: HTTP ${res.status} ${text.slice(0, 300)}`);
  console.log(`[feed] publicerat: ${text.slice(0, 200)}`);

  // ⛔ FOILIO-LANEN ÄR NEDLAGD (ägarbeslut 2026-09-11): setsläppen ur katalogen
  //    dubblerade de godkända nyheterna. Steget i scrape-all är borttaget, men det
  //    som redan låg på volymen försvinner bara om någon skickar lanen TOM — därför
  //    här, varje körning. Ta bort när volymen bevisligen är ren och lanen ur JOB_LANES.
  const clear = await fetch(`${appUrl}/api/cron/feed-publish`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cron-secret": secret },
    body: JSON.stringify({ lane: "foilio", generatedAt: payload.generatedAt, news: [], events: null }),
  });
  if (!clear.ok) console.warn(`::warning::[feed] kunde inte tömma foilio-lanen: HTTP ${clear.status}`);

  // Inkorgen sist och separat: ett fel här får inte hindra flödet, men ska synas rött.
  if (inbox.drafts.length > 0 || inbox.events.length > 0) {
    const inboxRes = await fetch(`${appUrl}/api/cron/feed-inbox`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": secret },
      body: JSON.stringify(inbox),
    });
    const inboxText = await inboxRes.text();
    if (!inboxRes.ok) throw new Error(`inkorgen misslyckades: HTTP ${inboxRes.status} ${inboxText.slice(0, 300)}`);
    console.log(`[feed] inkorg levererad: ${inboxText.slice(0, 200)}`);
  }
}

main().catch((error) => {
  console.error("[feed] körningen misslyckades:", error);
  process.exit(1);
});
