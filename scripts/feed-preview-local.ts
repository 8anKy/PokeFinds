// Lokal förhandsvisning: bygger .feed-cache/feed.json ur .github/feed/inbox.json som om varje utkast vore godkänt.
// Kör sedan `NEWS_FEED_PUBLIC=1 npx next dev` och öppna http://localhost:3000/nyheter. Rör aldrig prod.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { approveInputSchema, draftToNewsItem, feedDraftSchema } from "../src/lib/feed-inbox";
import { eventItemSchema, normalizeFeed, slugify, stableId, type FeedDocument } from "../src/lib/feed";

const inbox = JSON.parse(readFileSync(path.join(process.cwd(), ".github/feed/inbox.json"), "utf8"));
const dir = path.join(process.cwd(), ".feed-cache");
mkdirSync(dir, { recursive: true });
const file = path.join(dir, "feed.json");
const current: FeedDocument = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { generatedAt: new Date().toISOString(), news: [], events: [] };
const news = inbox.drafts.map((raw: unknown) => {
  const d = feedDraftSchema.parse(raw);
  return draftToNewsItem(d, approveInputSchema.parse({ ...d }));
});
// Evenemangen ur events.json, som byggjobbet gör det (slug härleds ur rubriken).
const rawEvents = JSON.parse(readFileSync(path.join(process.cwd(), ".github/feed/events.json"), "utf8")).events as Array<Record<string, unknown>>;
const events = rawEvents.map((raw) => {
  const slug = (raw.slug as string) || slugify(String(raw.title ?? ""));
  return eventItemSchema.parse({ id: stableId(`${slug}|${raw.startsAt ?? ""}`), ...raw, slug });
});
const doc = normalizeFeed({ generatedAt: new Date().toISOString(), news: [...news, ...current.news.filter((n) => n.lane !== "curated")], events });
writeFileSync(file, JSON.stringify(doc));
console.log(`skrev ${file}: ${doc.news.length} nyheter (${news.length} curated), ${doc.events.length} evenemang:`);
for (const n of news) console.log(` · /nyheter/${n.slug}`);
