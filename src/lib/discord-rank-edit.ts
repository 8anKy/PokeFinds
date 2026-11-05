/**
 * NIVÅKRAVET I ETT POSTAT INLÄGG FÖLJER BUTIKEN (ägarbeslut 2026-11-05).
 *
 * Webhallen öppnar heta förhandsbokningar för höga medlemsnivåer och sänker kravet stegvis
 * (30th Ditto Premium Collection postades 11:11 UTC 2026-11-03 med "Nivå 21+", stod på
 * nivå 9 två dygn senare). Inlägget stod kvar med 21+. Ägaren valde att REDIGERA inlägget
 * — inget nytt inlägg, ingen ping (Discord notifierar inte på redigeringar).
 *
 * Minnet: per butiks-URL de meddelanden lanen postat med ett nivåkrav, i samma form som
 * berikningen (`PostedRestockMessage`), så redigeringen bygger om embedden med SAMMA
 * `buildRestockEmbed` som postade den — aldrig en lappad kopia av Discords svar.
 * Bor i `.discord-restock-cache/rank-posts.json` och följer cachen + överlämningen.
 *
 * ⛔ "OKÄNT" ÄR ALDRIG "ALLA". Domen tar bara `rankLevel` ur ett LIVE-svar (1 = alla);
 *    en rad utan live-svar den här hämtningen rör ingenting.
 * ⛔ Kravet följs åt BÅDA hållen (inlägget ska säga det som gäller), men "(sänkt från …)"
 *    skrivs bara när det ligger under det vi först postade.
 */
import type { PostedRestockMessage, RestockPost } from "@/lib/discord-restock";

export interface RankMemoryEntry {
  /** Nivåkravet inlägget visar nu (1 = alla). */
  lvl: number;
  /** Nivåkravet när vi först postade — "sänkt från". */
  orig: number;
  /** När vi senast postade om URL:en (ms) — styr glömskan. */
  at: number;
  msgs: PostedRestockMessage[];
}

export type RankMemory = Record<string, RankMemoryEntry>;

/** Hur länge ett inlägg är värt att hålla aktuellt. En förhandsbokning öppnar och sänks inom dagar. */
export const RANK_MEMORY_DAYS = 14;

/** Butikens riktiga sida — utan lanens spårsuffix (`#butik`, `#butik@<id>`). */
export function baseListingUrl(url: string): string {
  const i = url.indexOf("#butik");
  return i === -1 ? url : url.slice(0, i);
}

/** Minns de postade meddelanden som bär ett nivåkrav. Muterar `mem`. */
export function rememberRankPosts(mem: RankMemory, messages: PostedRestockMessage[], now: number): void {
  // Ett utskick (publikt + Pro-spegeln) = en post per URL. Ett NYTT utskick om samma URL
  // (nästa våg) ersätter det gamla: det är det inlägget folk läser nu.
  const batch = new Map<string, { lvl: number; msgs: PostedRestockMessage[] }>();
  for (const m of messages) {
    for (const p of m.posts) {
      if (p.minRankLevel == null || p.minRankLevel <= 1) continue;
      const url = baseListingUrl(p.storeUrl);
      const e = batch.get(url) ?? { lvl: p.minRankLevel, msgs: [] };
      if (!e.msgs.includes(m)) e.msgs.push(m);
      batch.set(url, e);
    }
  }
  for (const [url, e] of batch) mem[url] = { lvl: e.lvl, orig: e.lvl, at: now, msgs: e.msgs };
}

/** URL:er vars live-nivå skiljer sig från den inlägget visar. Ren, muterar inget. */
export function rankLevelChanges(
  mem: RankMemory,
  items: { url: string; rankLevel?: number }[]
): { url: string; from: number; to: number }[] {
  const out: { url: string; from: number; to: number }[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (it.rankLevel == null) continue;
    const url = baseListingUrl(it.url);
    if (seen.has(url)) continue;
    seen.add(url);
    const entry = mem[url];
    if (entry && entry.lvl !== it.rankLevel) out.push({ url, from: entry.lvl, to: it.rankLevel });
  }
  return out;
}

/**
 * Skriver den nya nivån på minnet och på inläggen i dess meddelanden (som sedan byggs om
 * och PATCH:as). Muterar `entry`.
 */
export function applyRankLevel(entry: RankMemoryEntry, url: string, to: number): void {
  entry.lvl = to;
  for (const m of entry.msgs) {
    for (const p of m.posts) {
      if (baseListingUrl(p.storeUrl) !== url) continue;
      p.minRankLevel = to > 1 ? to : null;
      p.rankLevelWas = to < entry.orig ? entry.orig : null;
    }
  }
}

/** Glömmer inlägg äldre än `RANK_MEMORY_DAYS`. Muterar `mem`; true om något togs bort. */
export function pruneRankMemory(mem: RankMemory, now: number): boolean {
  let changed = false;
  for (const [url, e] of Object.entries(mem)) {
    if (now - e.at > RANK_MEMORY_DAYS * 86_400_000) {
      delete mem[url];
      changed = true;
    }
  }
  return changed;
}

/** Läser tillbaka filens innehåll — trasigt eller saknat ⇒ tomt minne, aldrig ett kast. */
export function parseRankMemory(raw: unknown): RankMemory {
  if (!raw || typeof raw !== "object") return {};
  const out: RankMemory = {};
  for (const [url, e] of Object.entries(raw as Record<string, unknown>)) {
    const v = e as Partial<RankMemoryEntry>;
    if (typeof v?.lvl !== "number" || typeof v.orig !== "number" || typeof v.at !== "number") continue;
    if (!Array.isArray(v.msgs)) continue;
    const msgs = v.msgs.filter(
      (m): m is PostedRestockMessage =>
        !!m && typeof m.channelId === "string" && typeof m.messageId === "string" && Array.isArray(m.posts)
    );
    if (msgs.length) out[url] = { lvl: v.lvl, orig: v.orig, at: v.at, msgs };
  }
  return out;
}

/** Fältets text: "Nivå 9+ (sänkt från 21+)", eller "Alla (sänkt från Nivå 21+)". null = inget fält. */
export function formatRankField(post: Pick<RestockPost, "minRankLevel" | "rankLevelWas">): string | null {
  const lvl = post.minRankLevel != null && post.minRankLevel > 1 ? post.minRankLevel : null;
  const was = post.rankLevelWas != null && post.rankLevelWas > (lvl ?? 1) ? post.rankLevelWas : null;
  if (lvl) return was ? `Nivå ${lvl}+ (sänkt från ${was}+)` : `Nivå ${lvl}+`;
  return was ? `Alla (sänkt från Nivå ${was}+)` : null;
}
