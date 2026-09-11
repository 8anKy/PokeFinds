/**
 * NYHETSINKORGEN — utkast som väntar på ägarens godkännande (2026-09-11).
 *
 * ⛔ FILEN ÄR DB-FRI OCH FS-FRI MED FLIT, som `src/lib/feed.ts`: den importeras av
 *    byggjobbet (död DATABASE_URL), av cron-rutten och av adminsidan. Här bor bara
 *    formen på ett utkast och domen om hur två inkorgar slås ihop.
 *
 * VARFÖR EN INKORG NÄR FLÖDET I ÖVRIGT PUBLICERAR SIG SJÄLVT: rss- och foilio-lanerna
 * är deterministiska — en RSS-post är källans egen rubrik och ett setsläpp är ett
 * datum ur vår katalog. Utkasten här är däremot SKRIVNA av en daglig AI-rutin
 * (webbsök + butikernas nyhetsbrev i mejlen), och en maskinskriven rubrik går inte
 * att vakta med en ordlista. Ägarbeslut 2026-09-11: den lanen godkänns för hand,
 * de två andra publicerar sig som förut.
 *
 * FLÖDET, tre hopp — inget av dem rör Neon:
 *   1. Rutinen (moln, en gång per dygn) skriver utkast till `.github/feed/inbox.json`
 *      och pushar. Mappen ligger utanför `watchPatterns` ⇒ ingen deploy.
 *   2. `news-feed.yml` (DB-fritt, 3 ggr/dygn) POST:ar filen till
 *      `/api/cron/feed-inbox`, som slår ihop den med `drafts.json` på volymen.
 *   3. Admin → Nyheter: rätta, byt bild, Godkänn ⇒ posten läggs i lane `curated`
 *      i feed.json; Avvisa ⇒ märks och göms. Rutinen får aldrig veta utfallet och
 *      behöver inte: den för sin EGEN `seen`-lista i git och drar aldrig samma
 *      nyhet två gånger, så ett avvisat utkast kommer inte tillbaka.
 */
import { z } from "zod";
import {
  EVENT_CATEGORIES,
  NEWS_CATEGORIES,
  eventItemSchema,
  newsItemSchema,
  slugify,
  stableId,
  type EventBlock,
  type EventItem,
  type NewsItem,
} from "@/lib/feed";

const isoDate = z
  .string()
  .min(4)
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), "ogiltigt datum");

const httpUrl = z
  .string()
  .min(1)
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v), "url måste vara https://");

/**
 * Brödtexten i ett utkast: STYCKEN som ren text, aldrig HTML/markdown. Ett stycke
 * som börjar med `## ` blir en mellanrubrik. Rutinen skriver 2–4 stycken med egna
 * ord (vad, när, vad ingår, varför det spelar roll); detaljsidan sätter själv
 * länken till källan längst ned — det är villkoret för att få sammanfatta.
 */
export const draftBodySchema = z
  .array(z.string().max(1500))
  .max(12)
  .default([])
  // Tomma stycken (dubbla radbrytningar i admin-fältet) faller bort i stället för att fälla posten.
  .transform((arr) => arr.map((p) => p.trim()).filter(Boolean));

/**
 * Ett utkast som rutinen skriver. ⛔ ALDRIG en egen `slug` i utkastet — den härleds
 * ur den GODKÄNDA rubriken vid publiceringen (`draftToNewsItem`), så ägarens
 * rättning av rubriken alltid syns i URL:en. Ägarbeslut 2026-09-11 (rev. samma dag):
 * utkasten får en brödtext ⇒ egen sida på /nyheter/<slug>; ingressen är teasern i listan.
 */
export const feedDraftSchema = z.object({
  /** Stabil ur URL:en (`stableId`), så samma nyhet aldrig blir två utkast. */
  id: z.string().min(1).max(64),
  title: z.string().min(3).max(300),
  summary: z.string().min(1).max(600),
  url: httpUrl,
  /** Källans namn för läsaren: sajten eller butiken ("Cardshop Sweden"). */
  source: z.string().min(1).max(80),
  category: z.enum(NEWS_CATEGORIES).default("MARKET"),
  /** När nyheten BRÖT (artikelns datum / mejlets datum), inte när rutinen såg den. */
  publishedAt: isoDate,
  imageUrl: httpUrl.nullable().default(null),
  imageFit: z.enum(["cover", "contain"]).default("cover"),
  /** Var rutinen hittade den — visas i admin, aldrig för läsaren. */
  origin: z.enum(["email", "web"]).default("web"),
  /** Rutinens egen anteckning till ägaren ("mejlet nämner 26/9 kl 10"). */
  note: z.string().max(400).default(""),
  /** När rutinen skrev utkastet. */
  foundAt: isoDate,
  body: draftBodySchema,
});
export type FeedDraft = z.infer<typeof feedDraftSchema>;

const httpUrlOrNull = httpUrl.nullable().default(null);

/**
 * Ett EVENEMANGSUTKAST (2026-09-11): svenska mässor och kortträffar som rutinen hittar.
 * Fälten speglar `eventItemSchema` men utan `slug` (härleds ur den godkända rubriken)
 * och med brödtexten som stycken, som nyhetsutkasten. ⛔ Bara det som står hos
 * ARRANGÖREN — datum, tider, plats och biljettlänk — och källan i `infoUrl`/`ticketUrl`.
 */
export const feedEventDraftSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(3).max(200),
  category: z.enum(EVENT_CATEGORIES).default("EXPO"),
  /** ISO MED tidszon (+02:00 sommartid, +01:00 vintertid). */
  startsAt: isoDate,
  endsAt: isoDate.nullable().default(null),
  city: z.string().max(80).nullable().default(null),
  venue: z.string().max(160).nullable().default(null),
  address: z.string().max(200).nullable().default(null),
  mapUrl: httpUrlOrNull,
  ticketUrl: httpUrlOrNull,
  infoUrl: httpUrlOrNull,
  imageUrl: httpUrlOrNull,
  imageFit: z.enum(["cover", "contain"]).default("cover"),
  organizer: z.string().max(120).nullable().default(null),
  summary: z.string().min(1).max(600),
  body: draftBodySchema,
  origin: z.enum(["email", "web"]).default("web"),
  note: z.string().max(400).default(""),
  foundAt: isoDate,
});
export type FeedEventDraft = z.infer<typeof feedEventDraftSchema>;

/** Filen i git: `.github/feed/inbox.json`. `seen` är rutinens minne, appen läser den inte. */
export const inboxFileSchema = z.object({
  drafts: z.array(z.unknown()).max(500).default([]),
  eventDrafts: z.array(z.unknown()).max(500).default([]),
  seen: z.array(z.object({ id: z.string(), url: z.string().max(2000), at: isoDate })).max(2000).default([]),
});

/** Kroppen i POST /api/cron/feed-inbox. */
export const inboxPublishSchema = z.object({
  generatedAt: isoDate,
  drafts: z.array(feedDraftSchema).max(500).default([]),
  events: z.array(feedEventDraftSchema).max(500).default([]),
});
export type InboxPublish = z.infer<typeof inboxPublishSchema>;

export const DRAFT_STATUSES = ["pending", "approved", "rejected"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** Extern bild ELLER en väg som börjar med `/` (ägarens uppladdade omslag). */
const imageUrlOrPath = z
  .string()
  .max(2000)
  .nullable()
  .default(null)
  .refine((v) => v === null || /^https?:\/\//i.test(v) || (v.startsWith("/") && !v.startsWith("//")), "imageUrl måste vara https:// eller en väg som börjar med /");

/**
 * En rad i `drafts.json` på volymen: utkastet + vad ägaren gjort med det.
 * ⛔ Raden bär ÄGARENS fält efter godkännandet (Object.assign i adminrutten), och de
 *    är vidare än rutinens: omslaget kan vara en uppladdad väg. 2026-09-11 låg schemat
 *    kvar på `https://` ⇒ första godkännandet med eget omslag gjorde HELA filen ogiltig
 *    och admin visade en tom inkorg. Radens schema måste rymma allt admin kan skriva.
 */
const entryState = {
  status: z.enum(DRAFT_STATUSES).default("pending"),
  /** När rutten först såg utkastet. */
  receivedAt: isoDate,
  decidedAt: isoDate.nullable().default(null),
};

export const inboxEntrySchema = feedDraftSchema.extend({ imageUrl: imageUrlOrPath, ...entryState });
export type InboxEntry = z.infer<typeof inboxEntrySchema>;

export const inboxEventEntrySchema = feedEventDraftSchema.extend({ imageUrl: imageUrlOrPath, ...entryState });
export type InboxEventEntry = z.infer<typeof inboxEventEntrySchema>;

function tolerantRows<S extends z.ZodTypeAny>(schema: S, label: string) {
  return z
    .array(z.unknown())
    .max(1000)
    .default([])
    .transform((rows) => {
      const out: z.output<S>[] = [];
      for (const row of rows) {
        const parsed = schema.safeParse(row);
        if (parsed.success) out.push(parsed.data);
        else console.error(`[feed-inbox] ${label} hoppades över:`, parsed.error.issues.slice(0, 2), (row as { id?: string })?.id);
      }
      return out;
    });
}

/**
 * ⛔ EN TRASIG RAD FÄLLER ALDRIG INKORGEN. Raderna valideras en och en; den som inte
 *    går igenom loggas och hoppas över, resten visas. Ett helt dokument som underkänns
 *    hade gömt varje väntande utkast bakom ett enda felformat fält.
 */
export const inboxDocumentSchema = z.object({
  updatedAt: isoDate,
  items: tolerantRows(inboxEntrySchema, "nyhetsrad"),
  events: tolerantRows(inboxEventEntrySchema, "evenemangsrad"),
});
export type InboxDocument = z.infer<typeof inboxDocumentSchema>;

export const EMPTY_INBOX: InboxDocument = { updatedAt: new Date(0).toISOString(), items: [], events: [] };

/** Ett AVGJORT utkast ligger kvar så länge i admin (för "ångra"), sedan städas det. */
export const DECIDED_KEEP_DAYS = 60;
/** Ett VÄNTANDE utkast äldre än så här är inte nyheter längre — det göms utan beslut. */
export const PENDING_KEEP_DAYS = 30;

/**
 * Slår ihop det rutinen skickat med det vi redan har. ⛔ ETT AVGJORT UTKAST ÄNDRAS
 * ALDRIG av en ny leverans, och ett väntande får inte heller sina fält omskrivna:
 * rutinen skickar hela filen vid varje körning, och hade den vunnit hade ägarens
 * rättningar (som sparas först vid godkännandet) inte spelat roll — men viktigare:
 * ett utkast ska se likadant ut i admin som när ägaren såg det senast.
 * ENDA undantaget: ett VÄNTANDE utkast får sin `body` ERSATT när leveransen bär en
 * LÄNGRE — ägarens rättningar sparas först vid godkännandet, så en väntande rad bär
 * ingenting ägaren skrivit, och en fullständigare text är alltid bättre än en kortare
 * (brödtexten kom till 2026-09-11 och de första utkasten skrevs utan källåtkomst).
 * Nya id:n blir `pending`. Gamla rader städas på ålder.
 */
function bodyLength(body: string[]): number {
  return body.reduce((n, p) => n + p.length, 0);
}

export function mergeInbox(current: InboxDocument, incoming: InboxPublish, now = new Date()): InboxDocument {
  const byId = new Map(current.items.map((e) => [e.id, e] as const));
  let added = 0;
  let changed = false;
  for (const draft of incoming.drafts) {
    const existing = byId.get(draft.id);
    if (existing) {
      if (existing.status === "pending" && bodyLength(draft.body) > bodyLength(existing.body)) {
        byId.set(draft.id, { ...existing, body: draft.body });
        changed = true;
      }
      continue;
    }
    byId.set(draft.id, { ...draft, status: "pending", receivedAt: now.toISOString(), decidedAt: null });
    added++;
  }

  const pendingCutoff = now.getTime() - PENDING_KEEP_DAYS * 86_400_000;
  const decidedCutoff = now.getTime() - DECIDED_KEEP_DAYS * 86_400_000;
  const items = [...byId.values()]
    .filter((e) => {
      if (e.status === "pending") return Date.parse(e.publishedAt) >= pendingCutoff;
      return Date.parse(e.decidedAt ?? e.receivedAt) >= decidedCutoff;
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  // Evenemangen: samma regler, men ett VÄNTANDE evenemang städas när det har PASSERAT —
  // ett utkast om en mässa som redan varit har ingen läsare kvar.
  const evById = new Map(current.events.map((e) => [e.id, e] as const));
  for (const draft of incoming.events) {
    const existing = evById.get(draft.id);
    if (existing) {
      if (existing.status === "pending" && bodyLength(draft.body) > bodyLength(existing.body)) {
        evById.set(draft.id, { ...existing, body: draft.body });
        changed = true;
      }
      continue;
    }
    evById.set(draft.id, { ...draft, status: "pending", receivedAt: now.toISOString(), decidedAt: null });
    added++;
  }
  const events = [...evById.values()]
    .filter((e) => {
      if (e.status === "pending") return Date.parse(e.endsAt ?? e.startsAt) >= now.getTime() - 86_400_000;
      return Date.parse(e.decidedAt ?? e.receivedAt) >= decidedCutoff;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  const touched = added > 0 || changed || items.length !== current.items.length || events.length !== current.events.length;
  return { updatedAt: touched ? now.toISOString() : current.updatedAt, items, events };
}

/** Fälten ägaren får rätta i admin innan posten godkänns. */
export const approveInputSchema = z.object({
  title: z.string().trim().min(3).max(300),
  summary: z.string().trim().max(600),
  url: httpUrl,
  source: z.string().trim().min(1).max(80),
  category: z.enum(NEWS_CATEGORIES),
  publishedAt: isoDate,
  imageUrl: imageUrlOrPath,
  imageFit: z.enum(["cover", "contain"]),
  body: draftBodySchema,
});
export type ApproveInput = z.infer<typeof approveInputSchema>;

/** Stycken ⇒ block. `## Rubrik` blir en mellanrubrik, allt annat ett stycke. */
export function paragraphsToBlocks(paragraphs: string[]): EventBlock[] {
  return paragraphs
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith("## ") ? { type: "h" as const, text: p.slice(3).trim() } : { type: "p" as const, text: p }));
}

/**
 * Den godkända posten som den läggs i flödet. Id:t är utkastets — så "ta bort ur
 * flödet" i admin hittar tillbaka till raden, och en post som godkänns igen
 * ersätter sig själv i stället för att dubbleras. Har posten en brödtext får den
 * `slug` (ur rubriken) och därmed en egen sida; utan text går raden rakt till källan.
 */
export function draftToNewsItem(entry: Pick<InboxEntry, "id">, input: ApproveInput): NewsItem {
  const body = paragraphsToBlocks(input.body);
  const slug = body.length > 0 ? slugify(input.title) || entry.id : null;
  return newsItemSchema.parse({
    id: entry.id,
    title: input.title,
    summary: input.summary,
    url: input.url,
    source: input.source,
    imageUrl: input.imageUrl,
    imageFit: input.imageFit,
    publishedAt: input.publishedAt,
    category: input.category,
    internal: false,
    slug,
    body,
    lane: "curated",
  });
}

/** Rutinens id för en URL — samma funktion som byggjobbet, så id:n aldrig krockar. */
export function draftId(url: string): string {
  return stableId(url.trim());
}

/** Fälten ägaren får rätta i admin innan ett evenemang godkänns. */
export const approveEventInputSchema = z.object({
  title: z.string().trim().min(3).max(200),
  category: z.enum(EVENT_CATEGORIES),
  startsAt: isoDate,
  endsAt: isoDate.nullable(),
  city: z.string().trim().max(80).nullable(),
  venue: z.string().trim().max(160).nullable(),
  address: z.string().trim().max(200).nullable(),
  mapUrl: httpUrlOrNull,
  ticketUrl: httpUrlOrNull,
  infoUrl: httpUrlOrNull,
  imageUrl: imageUrlOrPath,
  imageFit: z.enum(["cover", "contain"]),
  organizer: z.string().trim().max(120).nullable(),
  summary: z.string().trim().max(600),
  body: draftBodySchema,
});
export type ApproveEventInput = z.infer<typeof approveEventInputSchema>;

/**
 * Det godkända evenemanget som det läggs i flödet. Slug ur den godkända rubriken
 * (evenemang HAR alltid en sida). ⛔ `eventItemSchema.imageUrl` kräver en full URL —
 * ett uppladdat omslag (`/api/feed-cover/…`) görs absolut mot apex här.
 */
export function draftToEventItem(entry: Pick<InboxEventEntry, "id">, input: ApproveEventInput, baseUrl = "https://foilio.se"): EventItem {
  const imageUrl = input.imageUrl && input.imageUrl.startsWith("/") ? `${baseUrl.replace(/\/+$/, "")}${input.imageUrl}` : input.imageUrl;
  return eventItemSchema.parse({
    id: entry.id,
    slug: slugify(input.title) || entry.id,
    title: input.title,
    category: input.category,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    city: input.city || null,
    venue: input.venue || null,
    address: input.address || null,
    mapUrl: input.mapUrl,
    ticketUrl: input.ticketUrl,
    infoUrl: input.infoUrl,
    imageUrl,
    imageFit: input.imageFit,
    organizer: input.organizer || null,
    summary: input.summary,
    body: paragraphsToBlocks(input.body),
    lane: "curated",
  });
}

/** Evenemangets id: arrangörens länk om den finns, annars namn + startdatum. */
export function eventDraftId(d: { infoUrl?: string | null; ticketUrl?: string | null; title: string; startsAt: string }): string {
  const key = d.infoUrl || d.ticketUrl || `${slugify(d.title)}|${d.startsAt.slice(0, 10)}`;
  return stableId(key.trim());
}
