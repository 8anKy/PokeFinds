/**
 * Communityns butiksrapporter → Discords butikslarm-kanal (ägarbeslut 2026-10-04).
 *
 * Samma kanal som restock-lanens butiksvaror (`"stores"` i DISCORD_RESTOCK_CHANNELS):
 * läsaren där jagar redan varor på hyllan, och en medlems rapport från en filial är
 * exakt den signalen — inlägget bär därför samma form (butik, pris i butik, rek. pris,
 * "ring innan du åker") men säger UTTRYCKLIGEN att det är en medlemsrapport.
 *
 * EGEN spak: `DISCORD_BOT_TOKEN` + kanal-id (`DISCORD_STORE_REPORTS_CHANNEL_ID`,
 * standard = butikslarm-kanalen; "off" stänger av). Kanal-id:t är ingen hemlighet
 * (se discord-restock.ts), därför får standardvärdet stå i koden.
 *
 * ⛔ SPEGELN FÖLJER INLÄGGET. Meddelande-id:t sparas på rapporten och raderas när
 *    inlägget raderas, moderatorn döljer det eller kontot raderas — annars hade
 *    Discord blivit en väg förbi modereringen och GDPR-raderingen.
 * ⛔ "Säljs inte här" postas INTE: det är katalogdata om filialen, inget larm.
 * ⛔ En rapport om ett besök äldre än färskhetsfönstret postas inte — ett larm om
 *    gårdagens hylla skickar folk till en tom butik.
 * ⛔ FÅR ALDRIG KASTA. Anropas efter att inlägget är sparat; ett Discord-fel får inte
 *    synas som en misslyckad rapport.
 */
import { discordFetch } from "@/lib/discord";
import { formatPercent, formatPrice } from "@/lib/format";
import { localeUrl } from "@/lib/canonical";
import { msrpDelta } from "@/lib/msrp";
import { reportIsFresh, type StoreObservation } from "@/lib/community-stores";
import { voteLabelSv, type VoteTally } from "@/lib/store-report-votes";

const DEFAULT_CHANNEL_ID = "1551982852378337422";
const SEEN_COLOR = 0x22c55e;
const SOLD_OUT_COLOR = 0xef4444;
const DISPUTED_COLOR = 0xf59e0b;
const MAX_TITLE = 256;
const MAX_DESCRIPTION = 400;
const MAX_FIELD_VALUE = 1024;
const SITE = "https://foilio.se";

export interface StoreReportPost {
  postId: string;
  observation: StoreObservation;
  observedAt: Date;
  productLabel: string;
  productSlug: string | null;
  /** Katalogens bild — relativ (/api/cm-image/…) eller absolut. */
  productImageUrl: string | null;
  msrpOre: number | null;
  priceOre: number;
  /** Medlemmens kommentar; null när de inte skrev någon. */
  comment: string | null;
  /** Signerad läs-URL för medlemmens första foto, om något. */
  photoUrl: string | null;
  authorName: string;
  nearbyAtSubmit: boolean;
  /** Andra medlemmars röster — inlägget REDIGERAS när de ändras (lib/store-report-votes.ts). */
  confirmCount?: number;
  disputeCount?: number;
  lastVote?: VoteTally["lastVote"];
  store: {
    id: string;
    name: string;
    address: string;
    city: string;
    latitude: number | null;
    longitude: number | null;
    logoUrl?: string | null;
  };
}

export interface DiscordStoreReportConfig {
  botToken: string;
  channelId: string;
}

/** Läser env vid ANROPET (Railway bygger utan runtime-env). */
export function discordStoreReportConfig(): DiscordStoreReportConfig | null {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const raw = process.env.DISCORD_STORE_REPORTS_CHANNEL_ID?.trim();
  if (!botToken || raw === "off") return null;
  return { botToken, channelId: raw || DEFAULT_CHANNEL_ID };
}

/** Bara färska fynd och slutsålt är larm; "säljs inte" och gamla besök är det inte. */
export function shouldPostStoreReport(
  report: Pick<StoreReportPost, "observation" | "observedAt">,
  now = Date.now()
): boolean {
  if (report.observation === "NOT_CARRIED") return false;
  return reportIsFresh(report.observedAt.toISOString(), now);
}

function clamp(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function absolute(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/")) return `${SITE}${url}`;
  return /^https:\/\//.test(url) ? url : null;
}

/** Discords markdown-länkar bryts av hakparenteser i texten — byt dem mot vanliga. */
function linkText(s: string): string {
  return s.replace(/[[\]]/g, (c) => (c === "[" ? "(" : ")"));
}

export function directionsUrl(store: StoreReportPost["store"]): string {
  const destination =
    store.latitude != null && store.longitude != null
      ? `${store.latitude},${store.longitude}`
      : `${store.address}, ${store.city}, Sweden`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

/** Ren funktion så formatet går att testa utan nätverk. */
export function buildStoreReportEmbed(post: StoreReportPost) {
  const seen = post.observation === "SEEN";
  const delta = msrpDelta(post.priceOre, post.msrpOre);
  const storeUrl = localeUrl(
    "sv",
    `/forum?store=${encodeURIComponent(post.store.id)}&view=nearby&status=1`
  );

  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: "Butik", value: clamp(post.store.name, MAX_FIELD_VALUE), inline: true },
    { name: "Pris i butik", value: formatPrice(post.priceOre), inline: true },
  ];
  if (delta) {
    fields.push({
      name: "Rek. pris",
      value:
        `${formatPrice(delta.msrpOre)} · ${delta.verdict === "good" ? "🟢" : "🔴"} ` +
        `${formatPercent(delta.percent)}`,
      inline: true,
    });
  }
  fields.push({
    name: "Adress",
    value: clamp(
      `${post.store.address}, ${post.store.city}\n[Vägbeskrivning](${directionsUrl(post.store)})`,
      MAX_FIELD_VALUE
    ),
    inline: false,
  });
  fields.push({
    name: "Rapporterad av",
    value: clamp(
      // ⛔ Platssignalen är ungefärlig, aldrig ett verifierat besök (community-v2.md).
      `${linkText(post.authorName)}${post.nearbyAtSubmit ? " · 📍 platsuppgift nära butiken" : ""}`,
      MAX_FIELD_VALUE
    ),
    inline: true,
  });
  const confirms = post.confirmCount ?? 0;
  const disputes = post.disputeCount ?? 0;
  // Rapportören räknas in (tallyVotes) — fältet visas först när någon annan röstat
  // eller rapportören bytt sida, annars säger det bara "1 finns kvar" om rapporten själv.
  if (post.lastVote) {
    const parts = [
      ...(confirms ? [`✅ ${confirms} ${voteLabelSv(post.observation, "CONFIRM")}`] : []),
      ...(disputes ? [`❌ ${disputes} ${voteLabelSv(post.observation, "DISPUTE")}`] : []),
    ];
    // <t:…:R> renderas av Discord som levande relativ tid ("för 3 minuter sedan").
    const last = post.lastVote
      ? `\nSenast: ${post.lastVote.kind === "CONFIRM" ? "✅" : "❌"} ${voteLabelSv(post.observation, post.lastVote.kind)} <t:${Math.floor(Date.parse(post.lastVote.at) / 1000)}:R>`
      : "";
    fields.push({ name: "Medlemmarna säger", value: parts.join(" · ") + last, inline: false });
  }
  const links = [
    `[Butikens status](${storeUrl})`,
    ...(post.productSlug
      ? [`[Prishistorik](${localeUrl("sv", `/produkter/${post.productSlug}`)})`]
      : []),
  ];
  fields.push({ name: "På Foilio", value: links.join(" · "), inline: false });

  const comment = post.comment?.replace(/\s+/g, " ").trim();
  const lead = seen
    ? `En medlem såg den på hyllan i ${post.store.name}.`
    : `En medlem rapporterar att den var slut i ${post.store.name}.`;
  const photo = absolute(post.photoUrl);
  const productImage = absolute(post.productImageUrl);
  const logo = absolute(post.store.logoUrl);

  return {
    author: {
      name: clamp(`${post.store.name} · ${post.store.city}`, MAX_TITLE),
      url: storeUrl,
      ...(logo ? { icon_url: logo } : {}),
    },
    // Ingen titellänk (ägarbeslut 2026-10-05): länkarna står i "På Foilio".
    title: clamp(`${seen ? "Finns på hyllan" : "Slut i butiken"}: ${post.productLabel}`, MAX_TITLE),
    description: clamp(comment ? `${lead}\n> ${comment}` : lead, MAX_DESCRIPTION),
    // Senaste rösten säger emot rapporten ⇒ gul kant: läsaren ska se direkt att
    // hyllan kanske inte ser ut så längre.
    color: post.lastVote?.kind === "DISPUTE" ? DISPUTED_COLOR : seen ? SEEN_COLOR : SOLD_OUT_COLOR,
    fields,
    // Medlemmens foto av hyllan är det mest övertygande i inlägget — stort. Katalogbilden
    // blir då miniatyr, och står ensam när inget foto finns.
    ...(photo ? { image: { url: photo } } : {}),
    ...(productImage ? { thumbnail: { url: productImage } } : {}),
    footer: {
      text: "Foilio Community · Medlemsrapport, inget garanterat lager — ring butiken innan du åker.",
    },
    timestamp: post.observedAt.toISOString(),
  };
}

/**
 * Postar rapporten. Returnerar meddelande-id:t (så spegeln kan raderas med inlägget)
 * eller null = inte postat. Loggar orsaken men kastar aldrig.
 */
export async function postStoreReportToDiscord(post: StoreReportPost): Promise<string | null> {
  const config = discordStoreReportConfig();
  if (!config || !shouldPostStoreReport(post)) return null;
  try {
    const res = await discordFetch(`/channels/${config.channelId}/messages`, {
      method: "POST",
      authorization: `Bot ${config.botToken}`,
      body: JSON.stringify({
        embeds: [buildStoreReportEmbed(post)],
        // Ingen @everyone/@here eller rollping ur en medlems kommentar.
        allowed_mentions: { parse: [] },
      }),
    });
    if (res.ok) return ((await res.json().catch(() => null)) as { id?: string } | null)?.id ?? null;
    console.error(
      `[discord-store-report] kunde inte posta rapport ${post.postId}: ${res.status} ${await res
        .text()
        .catch(() => "")}`
    );
    return null;
  } catch (err) {
    console.error("[discord-store-report] misslyckades:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Redigerar det BEFINTLIGA meddelandet (t.ex. när någon bekräftar) — inget nytt
 * inlägg, ingen ny notis i kanalen. `false` = misslyckades; 404 = någon har tagit
 * bort meddelandet i Discord, och då postas det inte igen.
 */
export async function editStoreReportInDiscord(messageId: string, post: StoreReportPost): Promise<boolean> {
  const config = discordStoreReportConfig();
  if (!config || !/^\d{5,25}$/.test(messageId)) return false;
  try {
    const res = await discordFetch(`/channels/${config.channelId}/messages/${messageId}`, {
      method: "PATCH",
      authorization: `Bot ${config.botToken}`,
      body: JSON.stringify({ embeds: [buildStoreReportEmbed(post)], allowed_mentions: { parse: [] } }),
    });
    if (!res.ok && res.status !== 404) {
      console.error(`[discord-store-report] kunde inte redigera ${messageId}: ${res.status}`);
    }
    return res.ok;
  } catch (err) {
    console.error("[discord-store-report] redigering misslyckades:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Tar bort speglingen. 404 = redan borta (någon raderade den i Discord) = klart. */
export async function deleteStoreReportFromDiscord(messageIds: (string | null | undefined)[]) {
  const config = discordStoreReportConfig();
  const ids = messageIds.filter((id): id is string => !!id && /^\d{5,25}$/.test(id));
  if (!config || !ids.length) return;
  await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await discordFetch(`/channels/${config.channelId}/messages/${id}`, {
          method: "DELETE",
          authorization: `Bot ${config.botToken}`,
        });
        if (!res.ok && res.status !== 404) {
          console.error(`[discord-store-report] kunde inte radera ${id}: ${res.status}`);
        }
      } catch (err) {
        console.error("[discord-store-report] radering misslyckades:", err instanceof Error ? err.message : err);
      }
    })
  );
}
