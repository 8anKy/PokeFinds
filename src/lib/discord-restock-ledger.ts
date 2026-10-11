/**
 * ÖVERLAPPET MELLAN JOBB — KANALEN ÄR DEN DELADE LIGGAREN (2026-10-11).
 *
 * Varför: lanen kör som 20-minutersjobb i Actions och mellan två jobb var den BLIND
 * ~1,5 min (förra jobbets sista hämtning → nästa jobbs första). 2026-10-11 kl 15:00
 * fylldes Speltrollet på exakt i glappet; en konkurrent postade 15:00, vi 15:01:19.
 * Nu startas nästa jobb MEDAN det gamla kör (se discord-restock.yml): det gamla tar en
 * ögonblicksbild av sitt state ~6 min före sitt slut, nästa jobb återställer den och tar
 * över på klockslaget (`cutoverAt`) — glappet krymper till ett vanligt pollintervall.
 *
 * ⛔ DUBBLETTSKYDDET. Ögonblicksbilden är några minuter gammal när nästa jobb tar över,
 *    och det gamla jobbet hann posta under de minuterna. Det nya jobbets första diff mot
 *    bilden ser samma övergångar. Utan skydd hade allt det gamla postade under de sista
 *    minuterna postats en gång till. Jobben delar inget filsystem och lanen får ALDRIG
 *    röra databasen — men båda skriver i samma Discord-kanaler. Kanalens historik ÄR
 *    därför den delade sanningen: innan det nya jobbet postar läser det kanalerna sedan
 *    bildens tidpunkt och hoppar över (kanal, butiks-URL, sort) som redan står där.
 * ⛔ Bara de PUBLIKA kanalerna läses: Pro-spegeln postas bara för det som gick ut publikt.
 * ⛔ Ett eget inlägg (meddelande-id i `ownIds`) räknas aldrig — det skulle annars blockera
 *    jobbets egna senare prisinlägg för samma URL.
 */
import { discordFetch } from "@/lib/discord";
import type { DiscordRestockConfig, RestockPost } from "@/lib/discord-restock";

export type LedgerKind = "restock" | "store" | "price";

export interface LedgerEntry {
  channelId: string;
  messageId: string;
  /** Embeddens länk = butikens produktsida i de publika kanalerna. */
  url: string;
  kind: LedgerKind;
  /** När meddelandet postades, ms. */
  at: number;
}

/** Vilken sorts inlägg en post blir — samma grenar som rubriken i buildRestockEmbed. */
export function postKind(p: Pick<RestockPost, "previousPriceOre" | "storeOnly">): LedgerKind {
  if (p.previousPriceOre != null) return "price";
  if (p.storeOnly === true) return "store";
  return "restock";
}

/** Sorten ur en postad embed — läser rubrikens prefix (buildRestockEmbed). */
export function embedKind(title: string | undefined): LedgerKind {
  const t = title ?? "";
  if (t.startsWith("Nytt lägre pris — ") || t.startsWith("Höjt pris — ")) return "price";
  if (t.startsWith("Finns i butik: ") || t.startsWith("Finns bara i butik: ")) return "store";
  return "restock";
}

/** De publika kanalerna lanen kan posta i (Pro-spegeln undantagen, se filhuvudet). */
export function publicRestockChannelIds(
  config: Pick<
    DiscordRestockConfig,
    "setChannels" | "seriesChannels" | "languageChannels" | "defaultChannelId" | "priceChannelId" | "storeChannelId"
  >
): string[] {
  const ids = new Set<string>();
  for (const m of [config.setChannels, config.seriesChannels, config.languageChannels]) {
    for (const id of Object.values(m)) if (id) ids.add(id);
  }
  for (const id of [config.defaultChannelId, config.priceChannelId, config.storeChannelId]) if (id) ids.add(id);
  return [...ids];
}

interface DiscordMessage {
  id?: string;
  timestamp?: string;
  embeds?: { url?: string; title?: string }[];
}

/** Ren: Discords meddelandelista → liggarrader sedan `sinceMs`. */
export function ledgerFromMessages(
  channelId: string,
  messages: unknown,
  sinceMs: number,
  ownIds: ReadonlySet<string> = new Set()
): LedgerEntry[] {
  if (!Array.isArray(messages)) return [];
  const out: LedgerEntry[] = [];
  for (const m of messages as DiscordMessage[]) {
    if (!m || typeof m.id !== "string" || ownIds.has(m.id)) continue;
    const at = Date.parse(m.timestamp ?? "");
    if (!Number.isFinite(at) || at < sinceMs) continue;
    for (const e of m.embeds ?? []) {
      if (!e || typeof e.url !== "string" || !e.url) continue;
      out.push({ channelId, messageId: m.id, url: e.url, kind: embedKind(e.title), at });
    }
  }
  return out;
}

/**
 * Har inlägget redan gått ut i den här kanalen? Påfyllningar och butiksinlägg matchar
 * inom `cooldownMs` (samma spärr som state-kartans `posted`), prisinlägg alltid — en
 * prissänkning är samma besked hela liggarens fönster (några minuter).
 */
export function findInLedger(
  entries: readonly LedgerEntry[],
  channelId: string,
  p: Pick<RestockPost, "storeUrl" | "previousPriceOre" | "storeOnly">,
  nowMs: number,
  cooldownMs: number
): LedgerEntry | null {
  const kind = postKind(p);
  for (const e of entries) {
    if (e.channelId !== channelId || e.url !== p.storeUrl || e.kind !== kind) continue;
    if (kind !== "price" && nowMs - e.at >= cooldownMs) continue;
    return e;
  }
  return null;
}

/**
 * Läser de senaste meddelandena i varje kanal (≤ 100, nyast först — fönstret är några
 * minuter, så en sida räcker utom i ett extremt släpp). `failed` = kanaler som inte gick
 * att läsa (boten saknar "Läsa meddelandehistorik"): anroparen loggar dem högt, för då
 * kan dubbletter slinka igenom vid jobbytet.
 */
export async function loadLedger(
  channelIds: readonly string[],
  sinceMs: number,
  botToken: string,
  ownIds: ReadonlySet<string> = new Set()
): Promise<{ entries: LedgerEntry[]; failed: string[] }> {
  const results = await Promise.all(
    channelIds.map(async (channelId) => {
      try {
        const res = await discordFetch(`/channels/${channelId}/messages?limit=100`, {
          method: "GET",
          authorization: `Bot ${botToken}`,
        });
        if (!res.ok) return { channelId, entries: null as LedgerEntry[] | null };
        return { channelId, entries: ledgerFromMessages(channelId, await res.json(), sinceMs, ownIds) };
      } catch {
        return { channelId, entries: null as LedgerEntry[] | null };
      }
    })
  );
  const entries: LedgerEntry[] = [];
  const failed: string[] = [];
  for (const r of results) {
    if (r.entries) entries.push(...r.entries);
    else failed.push(r.channelId);
  }
  return { entries, failed };
}

/**
 * Jobbets överlämningsfil (`handoff.json` bredvid state-filen).
 *  · `savedAt`   — när state-filen skrevs; liggaren läses från strax före.
 *  · `cutoverAt` — när det skrivande jobbet slutar posta; nästa jobb väntar till dess.
 *  · `final`     — true = jobbet var KLART (slutsparningen). false = ögonblicksbilden mitt i
 *                  jobbet: det gamla jobbet lever och levererar själv sin hit-kö, så nästa
 *                  jobb slänger den återställda kön i stället för att skicka den två gånger.
 */
export interface HandoffMeta {
  savedAt: number;
  cutoverAt: number;
  final: boolean;
}

export function parseHandoffMeta(raw: unknown): HandoffMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.savedAt !== "number" || typeof r.cutoverAt !== "number") return null;
  if (!Number.isFinite(r.savedAt) || !Number.isFinite(r.cutoverAt)) return null;
  return { savedAt: r.savedAt, cutoverAt: r.cutoverAt, final: r.final === true };
}

/**
 * Hur länge ska ett nytt jobb vänta innan det börjar posta? Bara på en ögonblicksbild
 * vars `cutoverAt` ligger i framtiden — och aldrig längre än `maxWaitMs`: en trasig
 * klocka eller en fil från framtiden får inte parkera lanen.
 */
export function cutoverWaitMs(meta: HandoffMeta | null, nowMs: number, maxWaitMs: number): number {
  if (!meta || meta.final) return 0;
  return Math.max(0, Math.min(maxWaitMs, meta.cutoverAt - nowMs));
}
