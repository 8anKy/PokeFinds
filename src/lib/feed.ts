/**
 * NYHETER & EVENEMANG — formen på flödet (2026-09-09).
 *
 * ⛔ FILEN ÄR DB-FRI OCH FS-FRI MED FLIT. Den importeras av BÅDE bygg-jobbet
 *    (`scripts/feed-build.ts`, som kör i GitHub Actions med en avsiktligt död
 *    DATABASE_URL) och appen. Här bor bara formen, domen om vad som är relevant
 *    och identiteten på en post — aldrig transport, aldrig lagring.
 *
 * VARFÖR INTE EN DATABASTABELL: Neon debiteras per vaken tid och varje väckning
 * köper minst 300 s. En nyhetslista som läses av varje besökare hade alltså varit
 * en av de dyraste ytorna i appen — dyrare än nyttan. Flödet är i stället EN
 * JSON-fil som ett GitHub-jobb bygger och POST:ar till `/api/cron/feed-publish`;
 * appen skriver den till Railway-volymen och sidorna läser filen. Noll DB-läsningar
 * per sidvisning, noll nya väckningar. Samma mönster som Discord-lanens larm-hits.
 *
 * ⛔ VI ÅTERGER ALDRIG EN ARTIKELS TEXT. En nyhet är rubrik + kort ingress + källa
 *    + länk UT till källan. Därför har nyheter ingen egen detaljsida: raden går
 *    direkt till artikeln. Evenemang har detaljsida — den texten är vår egen.
 */
import { z } from "zod";

/**
 * Nyhetens sort. Styr färgen på pillret och filterchipsen — håll listan kort.
 * `APP` = vad som är nytt i Foilio självt; den posten pekar alltid IN i appen.
 */
export const NEWS_CATEGORIES = ["RELEASE", "MARKET", "STORE", "APP"] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

/** Evenemangets sort. `OTHER` finns för att en post aldrig ska falla bort. */
export const EVENT_CATEGORIES = ["EXPO", "PRERELEASE", "TOURNAMENT", "OTHER"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

const isoDate = z
  .string()
  .min(4)
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), "ogiltigt datum");

/** Ett stycke i en text vi själva skrivit. Ingen HTML, ingen markdown — två sorters block. */
export const eventBlockSchema = z.object({
  type: z.enum(["h", "p"]),
  text: z.string().min(1).max(2000),
});
export type EventBlock = z.infer<typeof eventBlockSchema>;

export const newsItemSchema = z.object({
  /** Stabil över körningar — härledd ur URL:en, aldrig ur rubriken (som redigeras). */
  id: z.string().min(1).max(64),
  title: z.string().min(3).max(300),
  /** Ren text, aldrig HTML. Klipps i byggjobbet. */
  summary: z.string().max(600).default(""),
  /**
   * Extern artikel-URL, ELLER en väg inom appen när `internal` är true
   * (`/sets/sv12`). ⛔ Ingen `z.string().url()` här: den hade underkänt varje
   * intern väg, och en `//annan.sajt`-väg måste ändå fällas explicit — annars
   * blir en "intern" länk en öppen omdirigering.
   */
  url: z
    .string()
    .min(1)
    .max(2000)
    .refine((v) => /^https?:\/\//i.test(v) || (v.startsWith("/") && !v.startsWith("//")), "url måste vara https:// eller en väg som börjar med /"),
  /** Källans namn som det ska stå för läsaren ("Pokémon Blog"). */
  source: z.string().min(1).max(80),
  /**
   * Omslaget. Extern bild HOTLÄNKAS från källan (vi sparar aldrig andras bilder);
   * en väg som börjar med `/` är vår egen fil under `public/`. `null` ⇒ tonad platta.
   */
  imageUrl: z
    .string()
    .max(2000)
    .nullable()
    .default(null)
    .refine((v) => v === null || /^https?:\/\//i.test(v) || (v.startsWith("/") && !v.startsWith("//")), "imageUrl måste vara https:// eller en väg som börjar med /"),
  /**
   * Hur omslaget ska fylla sin ruta. ⛔ `contain` för LOGOTYPER (setlogga,
   * märkesbild): en bred, genomskinlig logga som beskärs med `cover` blir en
   * suddig färgklick — det var precis vad setsläppen visade första dygnet.
   * `cover` för foton och artikelbilder, där beskärning är rätt.
   */
  imageFit: z.enum(["cover", "contain"]).default("cover"),
  publishedAt: isoDate,
  category: z.enum(NEWS_CATEGORIES).default("MARKET"),
  /**
   * `true` = `url` är en väg INOM appen (`/sets/sv12`) och ska öppnas i samma
   * flik. ⛔ Skillnaden är inte kosmetisk: en extern länk öppnas i ny flik med
   * `rel="noopener"` och en intern gör det ALDRIG — en app som spretar ut i
   * webbläsarflikar när man trycker på sitt eget innehåll känns trasig.
   */
  internal: z.boolean().default(false),
  /**
   * URL-delen i /nyheter/[slug] — BARA för poster vi skrivit egen text till.
   * ⛔ En hämtad RSS-post får ALDRIG en slug: vi äger inte texten och har därför
   * ingenting att fylla en detaljsida med. Den raden går direkt till källan.
   */
  slug: z
    .string()
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug får bara innehålla a–z, 0–9 och bindestreck")
    .nullable()
    .default(null),
  /** Vår egen text om nyheten. Tom ⇒ ingen detaljsida, raden går till `url`. */
  body: z.array(eventBlockSchema).max(40).default([]),
  /**
   * Vilken producent posten kom ifrån. Två jobb fyller flödet: `rss` (DB-fritt,
   * flera gånger om dagen) och `foilio` (vår egen katalog, ett steg i nattkedjan
   * där Neon ändå är vaken). ⛔ Publiceringsrutten ERSÄTTER EN LANE I TAGET —
   * utan fältet hade det jobb som körde sist raderat det andras poster.
   * `curated` (2026-09-11) = poster ägaren GODKÄNT ur nyhetsinkorgen
   * (`src/lib/feed-inbox.ts`); den fylls en post i taget av adminrutten och får
   * därför ALDRIG skickas till `feed-publish` — en lane som ersätts i klump hade
   * raderat varje godkänd post vid nästa jobbkörning.
   */
  lane: z.enum(["rss", "foilio", "curated"]).default("rss"),
});
export type NewsItem = z.infer<typeof newsItemSchema>;

export const eventItemSchema = z.object({
  id: z.string().min(1).max(64),
  /** URL-delen i /evenemang/[slug]. Måste vara unik i dokumentet. */
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug får bara innehålla a–z, 0–9 och bindestreck"),
  title: z.string().min(3).max(200),
  category: z.enum(EVENT_CATEGORIES).default("OTHER"),
  startsAt: isoDate,
  endsAt: isoDate.nullable().default(null),
  city: z.string().max(80).nullable().default(null),
  venue: z.string().max(160).nullable().default(null),
  address: z.string().max(200).nullable().default(null),
  /** Karta öppnas hos kartleverantören — vi bäddar aldrig in en karta (kostar och spårar). */
  mapUrl: z.string().url().max(2000).nullable().default(null),
  /** Arrangörens biljettlänk. Finns den blir den sidans enda huvudknapp. */
  ticketUrl: z.string().url().max(2000).nullable().default(null),
  infoUrl: z.string().url().max(2000).nullable().default(null),
  /** Arrangörens affisch. Hämtas av byggjobbet ur biljettsidans `og:image`. */
  imageUrl: z.string().url().max(2000).nullable().default(null),
  imageFit: z.enum(["cover", "contain"]).default("cover"),
  organizer: z.string().max(120).nullable().default(null),
  summary: z.string().max(600).default(""),
  body: z.array(eventBlockSchema).max(60).default([]),
});
export type EventItem = z.infer<typeof eventItemSchema>;

export const FEED_LANES = ["rss", "foilio", "curated"] as const;
export type FeedLane = (typeof FEED_LANES)[number];
/** Lanerna ett JOBB får ersätta i klump. ⛔ `curated` står inte här — se `NewsItem.lane`. */
export const JOB_LANES = ["rss", "foilio"] as const;
export type JobLane = (typeof JOB_LANES)[number];

export const feedDocumentSchema = z.object({
  /** När jobbet byggde dokumentet. Visas som "uppdaterat" och styr osett-pricken. */
  generatedAt: isoDate,
  news: z.array(newsItemSchema).max(200).default([]),
  events: z.array(eventItemSchema).max(200).default([]),
});
export type FeedDocument = z.infer<typeof feedDocumentSchema>;

/**
 * Kroppen i POST /api/cron/feed-publish. `lane` säger vilken producent som talar;
 * rutten behåller de andra lanernas poster. `events` skickas bara av den lane som
 * äger dem (rss-jobbet läser evenemangsfilen) — utelämnas fältet rörs de inte.
 */
export const feedPublishSchema = z.object({
  lane: z.enum(JOB_LANES),
  generatedAt: isoDate,
  news: z.array(newsItemSchema).max(200).default([]),
  events: z.array(eventItemSchema).max(200).nullable().default(null),
});
export type FeedPublish = z.infer<typeof feedPublishSchema>;

export const EMPTY_FEED: FeedDocument = { generatedAt: new Date(0).toISOString(), news: [], events: [] };

/** Hur många nyheter som får ligga i dokumentet. Äldre faller bort — inget arkiv. */
export const MAX_NEWS = 60;
/** Hur länge ett avslutat evenemang ligger kvar innan det städas bort. */
export const EVENT_KEEP_DAYS = 1;

/**
 * Stabil id ur en sträng (FNV-1a, base36). ⛔ Ingen `crypto`-import: filen körs
 * både i Node-jobbet och i appens bundle, och id:t behöver inte vara kryptografiskt
 * — bara samma tal för samma URL i varje körning, annars dubbleras posterna.
 */
export function stableId(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Andra varvet över samma sträng baklänges ⇒ 64 bitar, färre krockar.
  let g = 0x811c9dc5;
  for (let i = input.length - 1; i >= 0; i--) {
    g ^= input.charCodeAt(i);
    g = Math.imul(g, 0x01000193) >>> 0;
  }
  return h.toString(36) + g.toString(36);
}

/**
 * Slug ur en rubrik. Svenska och nordiska tecken TRANSLITTERERAS, aldrig strippas:
 * "Samlarkortsfestivalen Malmö" ska bli `...-malmo`, inte `...-malm`.
 */
const TRANSLIT: Record<string, string> = {
  å: "a", ä: "a", ö: "o", æ: "ae", ø: "o", é: "e", è: "e", ê: "e", ü: "u", á: "a", à: "a", í: "i", ó: "o", ú: "u", ñ: "n", ç: "c",
};

export function slugify(input: string): string {
  const full = input
    .toLowerCase()
    .replace(/[^a-z0-9]/g, (ch) => TRANSLIT[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (full.length <= 80) return full;
  // Kapa vid ett ORDSLUT: "…-1-1-miljoner-dol" läser som ett fel, "…-1-1-miljoner" gör det inte.
  const cut = full.slice(0, 80);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > 40 ? cut.slice(0, lastDash) : cut).replace(/-+$/g, "");
}

/**
 * ⛔ RELEVANSGRINDEN ÄR HELA POÄNGEN MED ATT VÅGA HÄMTA BREDA KÄLLOR. De flesta
 * Pokémon-flöden är till 80 % tv-spelsnyheter; utan grinden blir "Senaste nytt"
 * en spelblogg och kortsamlaren slutar titta. En post släpps igenom bara om
 * rubriken eller ingressen nämner något som hör till SAMLANDET.
 *
 * ⛔ Orden är avsiktligt SMALA. "pokemon" ensamt räcker inte (det står i varje
 *    rubrik hos källorna) och "game" är uteslutet (matchar tv-spelen). Vill du
 *    vidga: lägg till ord här, aldrig regexar på anropsstället.
 */
const RELEVANT = [
  "tcg",
  "trading card",
  "card game",
  "booster",
  "elite trainer",
  " etb",
  "pack",
  "set list",
  "expansion",
  "psa ",
  "cgc ",
  "beckett",
  "graded",
  "grading",
  "pull rate",
  "chase card",
  "illustration rare",
  "secret rare",
  "reverse holo",
  "prerelease",
  "pre-release",
  "preorder",
  "pre-order",
  "restock",
  "kort",
  "samlar",
  "kortsamlare",
  "mässa",
];

/** Ord som ALLTID fäller posten, även om ett relevant ord också finns. */
const IRRELEVANT = [
  "pokemon go",
  "pokémon go",
  "pokemon sleep",
  "unite",
  "speedrun",
  "anime episode",
  // ⛔ TV-SPELENS ord, tillagda efter en falsk positiv 2026-09-09: "New Pokémon
  //    Pokopia Expansion Pass Part 2 DLC trailer" tog sig igenom på ordet
  //    "expansion", som i TCG betyder set men i spelvärlden betyder nedladdning.
  "dlc",
  "expansion pass",
  "pokopia",
  "nintendo switch",
];

export function isTcgRelevant(...parts: (string | null | undefined)[]): boolean {
  const hay = ` ${parts.filter(Boolean).join(" ").toLowerCase()} `;
  if (IRRELEVANT.some((w) => hay.includes(w))) return false;
  return RELEVANT.some((w) => hay.includes(w));
}

const RELEASE_WORDS = ["prerelease", "pre-release", "preorder", "pre-order", "release date", "releases", "launch", "out now", "släpp"];

/**
 * Kategori ur texten, med källans egen kategori som botten. En rubrik som handlar
 * om ett släpp ska hamna under "släpp" oavsett var den kom ifrån.
 */
export function inferNewsCategory(fallback: NewsCategory, ...parts: (string | null | undefined)[]): NewsCategory {
  const hay = ` ${parts.filter(Boolean).join(" ").toLowerCase()} `;
  if (RELEASE_WORDS.some((w) => hay.includes(w))) return "RELEASE";
  return fallback;
}

/** Klipper ren text till en ingress utan att kapa mitt i ett ord. */
export function clampSummary(text: string, max = 240): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:–-]+$/, "")}…`;
}

/**
 * Sorterar och gallrar ett färdigbyggt dokument. ⛔ Anropas i BYGGJOBBET, inte i
 * appen: appen ska aldrig behöva räkna på flödet för att rendera det.
 *
 * `now` skickas in så testet kan frysa tiden.
 */
export function normalizeFeed(doc: FeedDocument, now = new Date()): FeedDocument {
  const seenNews = new Set<string>();
  const news = [...doc.news]
    .filter((n) => (seenNews.has(n.id) ? false : (seenNews.add(n.id), true)))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, MAX_NEWS);

  const keepAfter = now.getTime() - EVENT_KEEP_DAYS * 86_400_000;
  const seenSlug = new Set<string>();
  const events = [...doc.events]
    .filter((e) => {
      const end = Date.parse(e.endsAt ?? e.startsAt);
      if (Number.isNaN(end) || end < keepAfter) return false;
      // ⛔ Två evenemang med samma slug hade gett två sidor på samma URL — den
      // andra vinner aldrig, den försvinner bara tyst. Först i listan vinner.
      if (seenSlug.has(e.slug)) return false;
      seenSlug.add(e.slug);
      return true;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  return { generatedAt: doc.generatedAt, news, events };
}

/**
 * Dagar kvar till ett evenemang, räknat på DYGNSGRÄNS i lokal tid — inte på
 * 24-timmarsblock. "Om 1 dag" ska betyda i morgon, även om det bara är 3 timmar
 * kvar över midnatt.
 */
export function daysUntil(startsAt: string, now = new Date()): number {
  const start = new Date(startsAt);
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86_400_000);
}
