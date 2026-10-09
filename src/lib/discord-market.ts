/**
 * Korspostning av köp/sälj/byt-annonser till Discords köp-trade-sälj-kanal.
 *
 * EGEN spak: `DISCORD_MARKET_CHANNEL_ID` + `DISCORD_BOT_TOKEN`. Saknas endera är
 * hela modulen en no-op — forumet fungerar utan Discord, det är inte ett fel.
 * ⛔ Hänger INTE på `DISCORD_ENABLED` (rollhanteringen, som väntar på jurist-
 * granskning) — samma resonemang som restock-lanen: ett annonsinlägg i en publik
 * kanal är forumdata, inte en personuppgiftsbehandling utöver den tråden redan är.
 *
 * ⛔ BARA MARKNADSGRUPPEN. Kanalen delas med medlemmarnas egna annonser; ett
 *    vanligt communityinlägg där hade bara grumlat den (ägarbeslut 2026-10-09).
 * ⛔ ALLA FOTON LADDAS UPP SOM BILAGOR (fram + bak, upp till sex). En signerad
 *    bucket-URL dör efter 7 dygn och då hade annonsen tappat sina bilder.
 * ⛔ SPEGELN FÖLJER ANNONSEN: Såld/Avslutad, raderad, dold av moderator eller
 *    raderat konto ⇒ meddelandet tas bort (ägarbeslut 2026-10-09). Id:t sparas på
 *    `CommunityPost.discordMessageId` (services/market-discord.ts).
 * ⛔ Text- ELLER forumkanal: kanaltypen läses en gång per process. I en forumkanal
 *    blir varje annons en egen tråd och id:t är trådens.
 * ⛔ FÅR ALDRIG KASTA. Anropas fire-and-forget efter att tråden är SPARAD; ett
 *    Discord-fel får inte synas som ett misslyckat inlägg för användaren.
 */
import { discordFetch } from "@/lib/discord";
import { formatPrice } from "@/lib/format";
import { localeUrl } from "@/lib/canonical";
import type { ListingKindValue } from "@/lib/listing-rules";

/** Turkos signaturaccent (`holo.cyan` = #2dd4bf) som heltal, för embed-kanten. */
const BRAND_COLOR = 0x2dd4bf;
const MAX_TITLE = 256;
const MAX_THREAD_NAME = 100;
const MAX_DESCRIPTION = 600;
/** Discords tak är 10 bilagor; forumet tillåter 6 bilder per inlägg. */
export const MAX_MARKET_PHOTOS = 10;

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
  /** Katalogprodukten annonsen är kopplad till, för länken till marknadspriset. */
  productSlug?: string | null;
}

export interface MarketPhoto {
  bytes: Uint8Array;
  contentType: string;
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

function threadUrl(id: string): string {
  return localeUrl("sv", `/forum/t/${id}`);
}

function headline(post: MarketThreadPost): string {
  const kind = post.listingKind ? KIND_LABEL[post.listingKind] : null;
  return kind ? `${kind} — ${post.title}` : post.title;
}

/** Ren funktion så formatet går att testa utan nätverk. */
export function buildMarketEmbed(post: MarketThreadPost) {
  const fields: { name: string; value: string; inline: boolean }[] = [];
  if (post.priceOre != null && post.priceOre > 0) {
    fields.push({ name: "Pris", value: formatPrice(post.priceOre), inline: true });
  }
  if (post.condition && CONDITION_LABEL[post.condition]) {
    fields.push({ name: "Skick", value: CONDITION_LABEL[post.condition], inline: true });
  }
  fields.push({ name: "Säljare", value: clamp(post.authorName, 100), inline: true });
  if (post.productSlug) {
    fields.push({
      name: "Marknadspris",
      value: `[Se kortets pris på Foilio](${localeUrl("sv", `/produkter/${post.productSlug}`)})`,
      inline: false,
    });
  }

  return {
    title: clamp(headline(post), MAX_TITLE),
    url: threadUrl(post.id),
    description: clamp(post.content.replace(/\s+/g, " ").trim(), MAX_DESCRIPTION),
    color: BRAND_COLOR,
    fields,
    footer: { text: "Foilio Community · Köp, sälj & byt — svara i appen, inte här" },
    timestamp: new Date().toISOString(),
  };
}

const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function photoFileName(index: number, contentType: string): string {
  return `foilio-${index + 1}.${EXTENSION[contentType] ?? "jpg"}`;
}

/**
 * Meddelandets JSON-del. Fotona är VANLIGA bilagor (inte inbäddade i embeden):
 * Discord visar dem som ett galleri ovanför annonskortet, alla bilder lika stora,
 * och en senare åtgärd behöver aldrig röra dem.
 */
export function buildMarketMessage(post: MarketThreadPost, photos: Pick<MarketPhoto, "contentType">[]) {
  const shown = photos.slice(0, MAX_MARKET_PHOTOS);
  return {
    embeds: [buildMarketEmbed(post)],
    components: [
      {
        type: 1,
        components: [{ type: 2, style: 5, label: "Öppna annonsen i Foilio", url: threadUrl(post.id) }],
      },
    ],
    // Ingen @everyone/@here eller rollping ur en medlems annonstext.
    allowed_mentions: { parse: [] },
    attachments: shown.map((p, i) => ({ id: i, filename: photoFileName(i, p.contentType) })),
  };
}

/** Forumkanal (15) eller mediekanal (16) ⇒ varje annons blir en egen tråd. */
const channelIsForum = new Map<string, boolean>();

async function isForumChannel(config: DiscordMarketConfig): Promise<boolean> {
  const known = channelIsForum.get(config.channelId);
  if (known !== undefined) return known;
  const res = await discordFetch(`/channels/${config.channelId}`, {
    method: "GET",
    authorization: `Bot ${config.botToken}`,
  });
  if (!res.ok) throw new Error(`kanalen ${config.channelId} gick inte att läsa: ${res.status}`);
  const type = ((await res.json().catch(() => null)) as { type?: number } | null)?.type;
  const forum = type === 15 || type === 16;
  channelIsForum.set(config.channelId, forum);
  return forum;
}

function multipart(payload: unknown, photos: MarketPhoto[]): FormData {
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  photos.slice(0, MAX_MARKET_PHOTOS).forEach((p, i) => {
    form.append(`files[${i}]`, new Blob([new Uint8Array(p.bytes)], { type: p.contentType }), photoFileName(i, p.contentType));
  });
  return form;
}

/**
 * Postar annonsen med alla foton. Returnerar meddelandets id (forum: trådens id)
 * så spegeln kan tas bort med annonsen, eller null = inte postat. Kastar aldrig.
 */
export async function postMarketThreadToDiscord(
  post: MarketThreadPost,
  photos: MarketPhoto[] = []
): Promise<string | null> {
  const config = discordMarketConfig();
  if (!config) return null;
  try {
    const message = buildMarketMessage(post, photos);
    const forum = await isForumChannel(config);
    const res = forum
      ? await discordFetch(`/channels/${config.channelId}/threads`, {
          method: "POST",
          authorization: `Bot ${config.botToken}`,
          body: multipart({ name: clamp(headline(post), MAX_THREAD_NAME), message }, photos),
        })
      : await discordFetch(`/channels/${config.channelId}/messages`, {
          method: "POST",
          authorization: `Bot ${config.botToken}`,
          body: multipart(message, photos),
        });
    if (res.ok) return ((await res.json().catch(() => null)) as { id?: string } | null)?.id ?? null;
    // 403 = boten saknar "Send Messages"/"Attach Files"/"Create Posts", 404 = fel kanal-id,
    // 400 i ett forum = kanalen kräver taggar. Tyst för användaren — därav loggraden.
    console.error(
      `[discord-market] kunde inte posta annons ${post.id}: ${res.status} ${await res.text().catch(() => "")}`
    );
    return null;
  } catch (err) {
    console.error("[discord-market] misslyckades:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Tar bort speglingar. 404 = redan borta (någon raderade den i Discord) = klart. */
export async function deleteMarketPostsFromDiscord(ids: (string | null | undefined)[]): Promise<void> {
  const config = discordMarketConfig();
  const valid = ids.filter((id): id is string => !!id && /^\d{5,25}$/.test(id));
  if (!config || !valid.length) return;
  let forum: boolean;
  try {
    forum = await isForumChannel(config);
  } catch (err) {
    console.error("[discord-market] radering misslyckades:", err instanceof Error ? err.message : err);
    return;
  }
  const auth = `Bot ${config.botToken}`;
  await Promise.all(
    valid.map(async (id) => {
      try {
        let res = forum
          ? await discordFetch(`/channels/${id}`, { method: "DELETE", authorization: auth })
          : await discordFetch(`/channels/${config.channelId}/messages/${id}`, {
              method: "DELETE",
              authorization: auth,
            });
        // Utan "Manage Threads" får boten inte radera tråden — men alltid sitt eget
        // startinlägg (trådens id = startinläggets id), och då försvinner annonsen.
        if (forum && res.status === 403) {
          res = await discordFetch(`/channels/${id}/messages/${id}`, { method: "DELETE", authorization: auth });
        }
        if (!res.ok && res.status !== 404) {
          console.error(`[discord-market] kunde inte radera ${id}: ${res.status}`);
        }
      } catch (err) {
        console.error("[discord-market] radering misslyckades:", err instanceof Error ? err.message : err);
      }
    })
  );
}
