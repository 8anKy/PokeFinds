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
import { NEWS_CATEGORIES, newsItemSchema, stableId, type NewsItem } from "@/lib/feed";

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
 * Ett utkast som rutinen skriver. ⛔ ALDRIG `slug`/`body`: ägarbeslut 2026-09-11 —
 * utkasten är rubrik + ingress med egna ord + länk UT. Vill ägaren ge en post en
 * egen sida skrivs den in i `news.json` som förut.
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
});
export type FeedDraft = z.infer<typeof feedDraftSchema>;

/** Filen i git: `.github/feed/inbox.json`. `seen` är rutinens minne, appen läser den inte. */
export const inboxFileSchema = z.object({
  drafts: z.array(z.unknown()).max(500).default([]),
  seen: z.array(z.object({ id: z.string(), url: z.string().max(2000), at: isoDate })).max(2000).default([]),
});

/** Kroppen i POST /api/cron/feed-inbox. */
export const inboxPublishSchema = z.object({
  generatedAt: isoDate,
  drafts: z.array(feedDraftSchema).max(500).default([]),
});
export type InboxPublish = z.infer<typeof inboxPublishSchema>;

export const DRAFT_STATUSES = ["pending", "approved", "rejected"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** En rad i `drafts.json` på volymen: utkastet + vad ägaren gjort med det. */
export const inboxEntrySchema = feedDraftSchema.extend({
  status: z.enum(DRAFT_STATUSES).default("pending"),
  /** När rutten först såg utkastet. */
  receivedAt: isoDate,
  decidedAt: isoDate.nullable().default(null),
});
export type InboxEntry = z.infer<typeof inboxEntrySchema>;

export const inboxDocumentSchema = z.object({
  updatedAt: isoDate,
  items: z.array(inboxEntrySchema).max(1000).default([]),
});
export type InboxDocument = z.infer<typeof inboxDocumentSchema>;

export const EMPTY_INBOX: InboxDocument = { updatedAt: new Date(0).toISOString(), items: [] };

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
 * Nya id:n blir `pending`. Gamla rader städas på ålder.
 */
export function mergeInbox(current: InboxDocument, incoming: InboxPublish, now = new Date()): InboxDocument {
  const byId = new Map(current.items.map((e) => [e.id, e] as const));
  let added = 0;
  for (const draft of incoming.drafts) {
    if (byId.has(draft.id)) continue;
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

  return { updatedAt: added > 0 || items.length !== current.items.length ? now.toISOString() : current.updatedAt, items };
}

/** Fälten ägaren får rätta i admin innan posten godkänns. */
export const approveInputSchema = z.object({
  title: z.string().trim().min(3).max(300),
  summary: z.string().trim().max(600),
  url: httpUrl,
  source: z.string().trim().min(1).max(80),
  category: z.enum(NEWS_CATEGORIES),
  publishedAt: isoDate,
  /** Extern bild ELLER en väg som börjar med `/` (ägarens uppladdade omslag). */
  imageUrl: z
    .string()
    .max(2000)
    .nullable()
    .refine((v) => v === null || /^https?:\/\//i.test(v) || (v.startsWith("/") && !v.startsWith("//")), "imageUrl måste vara https:// eller en väg som börjar med /"),
  imageFit: z.enum(["cover", "contain"]),
});
export type ApproveInput = z.infer<typeof approveInputSchema>;

/**
 * Den godkända posten som den läggs i flödet. Id:t är utkastets — så "ta bort ur
 * flödet" i admin hittar tillbaka till raden, och en post som godkänns igen
 * ersätter sig själv i stället för att dubbleras.
 */
export function draftToNewsItem(entry: Pick<InboxEntry, "id">, input: ApproveInput): NewsItem {
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
    slug: null,
    body: [],
    lane: "curated",
  });
}

/** Rutinens id för en URL — samma funktion som byggjobbet, så id:n aldrig krockar. */
export function draftId(url: string): string {
  return stableId(url.trim());
}
