/**
 * Korspostning av köp/sälj/byt-trådar till Discord (#marknad).
 *
 * EGEN spak: `DISCORD_MARKET_CHANNEL_ID` + `DISCORD_BOT_TOKEN`. Saknas endera är
 * hela modulen en no-op — forumet fungerar utan Discord, det är inte ett fel.
 * ⛔ Hänger INTE på `DISCORD_ENABLED` (rollhanteringen, som väntar på jurist-
 * granskning) — samma resonemang som restock-lanen: ett annonsinlägg i en publik
 * kanal är forumdata, inte en personuppgiftsbehandling utöver den tråden redan är.
 *
 * ⛔ FÅR ALDRIG KASTA. Anropas fire-and-forget efter att tråden är SPARAD; ett
 * Discord-fel får inte synas som ett misslyckat inlägg för användaren.
 */
import { discordFetch } from "@/lib/discord";
import { formatPrice } from "@/lib/format";
import { localeUrl } from "@/lib/canonical";
import type { ListingKindValue } from "@/lib/listing-rules";

/** Turkos signaturaccent (`holo.cyan` = #2dd4bf) som heltal, för embed-kanten. */
const BRAND_COLOR = 0x2dd4bf;
const MAX_TITLE = 256;
const MAX_DESCRIPTION = 300;

const KIND_LABEL: Record<ListingKindValue, string> = {
  SELL: "Säljes",
  BUY: "Köpes",
  TRADE: "Bytes",
};

/** Speglar `Condition`-namnrymden i messages/sv.json — Discord-copyn är svensk. */
const CONDITION_LABEL: Record<string, string> = {
  MINT: "Mint",
  NEAR_MINT: "Near Mint",
  EXCELLENT: "Excellent",
  GOOD: "Good",
  PLAYED: "Played",
  POOR: "Poor",
  SEALED: "Sealed",
};

export interface MarketThreadPost {
  id: string;
  title: string;
  content: string;
  listingKind: ListingKindValue | null;
  priceOre: number | null;
  condition: string | null;
  authorName: string;
  /** Signerad läs-URL för första bilden, om någon. */
  imageUrl?: string | null;
}

export interface DiscordMarketConfig {
  botToken: string;
  channelId: string;
}

/** Läser env vid ANROPET (Railway bygger utan runtime-env). */
export function discordMarketConfig(): DiscordMarketConfig | null {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const channelId = process.env.DISCORD_MARKET_CHANNEL_ID?.trim();
  if (!botToken || !channelId) return null;
  return { botToken, channelId };
}

function clamp(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Ren funktion så formatet går att testa utan nätverk. */
export function buildMarketEmbed(post: MarketThreadPost) {
  const kind = post.listingKind ? KIND_LABEL[post.listingKind] : null;
  const fields: { name: string; value: string; inline: boolean }[] = [];
  if (post.priceOre != null && post.priceOre > 0) {
    fields.push({ name: "Pris", value: formatPrice(post.priceOre), inline: true });
  }
  if (post.condition && CONDITION_LABEL[post.condition]) {
    fields.push({ name: "Skick", value: CONDITION_LABEL[post.condition], inline: true });
  }
  fields.push({ name: "Säljare", value: clamp(post.authorName, 100), inline: true });

  const url = localeUrl("sv", `/forum/t/${post.id}`);
  return {
    title: clamp(kind ? `${kind} — ${post.title}` : post.title, MAX_TITLE),
    url,
    description: clamp(post.content.replace(/\s+/g, " ").trim(), MAX_DESCRIPTION),
    color: BRAND_COLOR,
    fields,
    ...(post.imageUrl ? { thumbnail: { url: post.imageUrl } } : {}),
    footer: { text: "Foilio · Köp/Sälj/Byt — svara i forumet, inte här" },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Postar tråden i marknadskanalen. `false` = inte skickat (avstängt eller fel);
 * loggar orsaken men kastar aldrig.
 */
export async function postMarketThreadToDiscord(post: MarketThreadPost): Promise<boolean> {
  const config = discordMarketConfig();
  if (!config) return false;
  try {
    const res = await discordFetch(`/channels/${config.channelId}/messages`, {
      method: "POST",
      authorization: `Bot ${config.botToken}`,
      body: JSON.stringify({ embeds: [buildMarketEmbed(post)] }),
    });
    if (res.ok) return true;
    // 403 = boten saknar "Send Messages" i kanalen, 404 = fel kanal-id. Tyst för
    // användaren — därav loggraden.
    console.error(
      `[discord-market] kunde inte posta tråd ${post.id}: ${res.status} ${await res
        .text()
        .catch(() => "")}`
    );
    return false;
  } catch (err) {
    console.error("[discord-market] misslyckades:", err instanceof Error ? err.message : err);
    return false;
  }
}
