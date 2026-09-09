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
  slugify,
  stableId,
  type NewsCategory,
  type NewsItem,
} from "../src/lib/feed";
import { parseFeed } from "../src/lib/rss";

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

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
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
        internal: false,
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
  const payload = feedPublishSchema.parse({
    lane: "rss",
    generatedAt: new Date().toISOString(),
    news,
    events,
  });
  console.log(`[feed] rss-lane: ${payload.news.length} nyheter, ${payload.events?.length ?? 0} evenemang.`);

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
}

main().catch((error) => {
  console.error("[feed] körningen misslyckades:", error);
  process.exit(1);
});
