/**
 * DISCORD-KOMMANDOT /pris (Pro, ägarbeslut 2026-10-10) — ren logik, ingen DB, inget nät.
 *
 * `/pris produkt:<kort eller produkt>` svarar med svenska butikers priser, marknadsvärde
 * (Cardmarket) och Tradera sålt. Svaret byggs HELT ur nattens katalogsnapshot på
 * volymen (lib/catalog-snapshot.ts): sökindexet hittar produkten, skärvan ger priserna.
 * ⛔ Kommandot väcker ALDRIG Neon — en fråga per kommando (och per tangenttryck i
 *    autocomplete) hade köpt minst 300 s vaken tid varje gång.
 * ⛔ Priser och lager är NATTENS — svaret säger det ("Priser från <t:…:R>"), aldrig "nu".
 * ⛔ Pro avgörs av Pro-ROLLEN på medlemmen i interaktionen (Discord skickar rollerna med),
 *    samma roll som Discord-synken sätter ur `isPro()` — ingen egen regel, ingen DB-fråga.
 * Svaren är EFEMÄRA (bara den som frågade ser dem) — UTOM i pris-kanalen
 *    (`priceChannelId`, ägarbeslut 2026-10-10): där är svaren publika som skyltfönster för
 *    Pro. Datan är ändå gratis på foilio.se; det Pro betalar för är bekvämligheten. En
 *    kanal i stället för överallt, så uppslagen aldrig tränger undan restock-larmen.
 */
import { formatPrice } from "@/lib/format";
import { isStoreRetailer } from "@/lib/offer-source";
import { formatTraderaSold, marketDelta, formatMarketValue } from "@/lib/market-compare";
import { CARDMARKET_RETAILER_NAME } from "@/lib/market-value";
import type { SnapshotEntry, SnapshotIndexEntry } from "@/lib/catalog-snapshot";

export const PRICE_COMMAND_NAME = "pris";
export const PRICE_COMMAND_OPTION = "produkt";

/** Kommandots definition — registreras av scripts/register-discord-commands.ts. */
export const PRICE_COMMAND = {
  name: PRICE_COMMAND_NAME,
  description: "Priser i svenska butiker, marknadsvärde och Tradera sålt (Foilio Pro)",
  type: 1,
  options: [
    {
      type: 3, // STRING
      name: PRICE_COMMAND_OPTION,
      description: "Kort eller produkt, t.ex. \"Pitch Black ETB\" eller \"Charizard 199\"",
      required: true,
      autocomplete: true,
    },
  ],
} as const;

/** Efemärt svar (flags 64 = bara den som frågade ser det). */
export const EPHEMERAL = 64;

/**
 * Kanalen där /pris-svaren är PUBLIKA (#pris-koll). Kanal-id är inte en hemlighet;
 * `DISCORD_PRICE_CHANNEL_ID` i Railway skriver över utan kodändring.
 */
export function priceChannelId(): string {
  return process.env.DISCORD_PRICE_CHANNEL_ID?.trim() || "1558526513937391868";
}

/** Publikt i pris-kanalen, efemärt överallt annars. */
export function answerFlags(channelId: string | undefined | null): number | undefined {
  return channelId && channelId === priceChannelId() ? undefined : EPHEMERAL;
}

const BRAND_COLOR = 0x2dd4bf;
const MAX_STORE_LINES = 5;

/** Gemener, utan diakriter, bara [a-z0-9] + mellanslag. "Pokémon" ⇒ "pokemon". */
export function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .trim();
}

/** Förkortningar samlare skriver — läggs till i höstacken när titeln bär hela frasen. */
const ABBREVIATIONS: [string, string][] = [
  ["elite trainer box", "etb"],
  ["ultra premium collection", "upc"],
  ["super premium collection", "spc"],
];

/** Ord användaren skriver för japanska — matchar indexets språk i stället för titeln. */
const JP_WORDS = new Set(["jp", "jap", "japansk", "japanska", "japanese"]);

/**
 * Hitta produkter: ALLA ord måste finnas i titel/set/nummer. Rangordning: exakt titel
 * → titel som börjar med frågan → kortare titel (den generella varan före varianter).
 */
export function searchCatalogIndex(
  entries: readonly SnapshotIndexEntry[],
  query: string,
  limit = 25
): SnapshotIndexEntry[] {
  const q = normalizeSearch(query);
  if (!q) return [];
  const words = q.split(" ").filter(Boolean);
  const wantJp = words.some((w) => JP_WORDS.has(w));
  const terms = words.filter((w) => !JP_WORDS.has(w));
  if (!terms.length) return [];
  const scored: { e: SnapshotIndexEntry; score: number }[] = [];
  for (const e of entries) {
    if (wantJp && e.l !== "JP") continue;
    const title = normalizeSearch(e.t);
    const abbr = ABBREVIATIONS.filter(([full]) => title.includes(full)).map(([, short]) => short).join(" ");
    const hay = `${title} ${abbr} ${e.set ? normalizeSearch(e.set) : ""} ${e.n ? normalizeSearch(e.n) : ""}`;
    // Kortnummer: "199" ska träffa "199/165" och "199" — jämför mot numrets delar också.
    const numParts = e.n ? normalizeSearch(e.n).split("/") : [];
    if (!terms.every((t) => hay.includes(t) || numParts.includes(t))) continue;
    const qTitle = terms.join(" ");
    let score = 0;
    if (title === qTitle) score += 1000;
    else if (title.startsWith(qTitle)) score += 500;
    else if (title.includes(qTitle)) score += 250;
    // Engelska först när användaren inte bett om japanska.
    if (!wantJp && e.l === "EN") score += 50;
    score -= title.length / 10;
    scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.e);
}

/** "Pitch Black Elite Trainer Box · Pitch Black (JP)" — Discords tak är 100 tecken. */
export function choiceLabel(e: SnapshotIndexEntry): string {
  const parts = [e.t];
  if (e.n) parts.push(`#${e.n}`);
  if (e.set && !normalizeSearch(e.t).includes(normalizeSearch(e.set))) parts.push(e.set);
  const label = `${parts.join(" · ")}${e.l === "JP" ? " (JP)" : ""}`;
  return label.length <= 100 ? label : `${label.slice(0, 99)}…`;
}

/** Autocomplete-val: värdet är sluggen (≤ 100 tecken — längre slugs utelämnas). */
export function autocompleteChoices(hits: readonly SnapshotIndexEntry[]): { name: string; value: string }[] {
  return hits.filter((e) => e.s.length <= 100).slice(0, 25).map((e) => ({ name: choiceLabel(e), value: e.s }));
}

/**
 * Vilken produkt ett inskickat värde avser: en slug ur autocomplete vinner, annars
 * bästa sökträffen på fritexten.
 */
export function resolveQuery(entries: readonly SnapshotIndexEntry[], value: string): SnapshotIndexEntry | null {
  const exact = entries.find((e) => e.s === value);
  if (exact) return exact;
  return searchCatalogIndex(entries, value, 1)[0] ?? null;
}

function absolute(url: string | null, appUrl: string): string | null {
  if (!url) return null;
  return url.startsWith("/") ? `${appUrl}${url}` : url;
}

/** Svaret på /pris: ett embed byggt ur snapshotens skal + priser. */
export function buildPriceEmbed(entry: SnapshotEntry, index: SnapshotIndexEntry | null, appUrl: string) {
  const offers = entry.prices.offers.filter((o) => o.price != null && o.price > 0);
  const stores = offers
    .filter((o) => isStoreRetailer(o.retailer.name) && (o.stockStatus === "IN_STOCK" || o.stockStatus === "LIMITED"))
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  const cm = offers
    .filter((o) => o.retailer.name === CARDMARKET_RETAILER_NAME)
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0];

  const fields: { name: string; value: string; inline: boolean }[] = [];
  if (stores.length) {
    const lines = stores
      .slice(0, MAX_STORE_LINES)
      .map((o) => `[${o.retailer.name}](${o.url}) · ${formatPrice(o.price)}`);
    if (stores.length > MAX_STORE_LINES) lines.push(`+${stores.length - MAX_STORE_LINES} butiker till`);
    fields.push({ name: "I lager i butik", value: lines.join("\n"), inline: false });
  } else {
    fields.push({ name: "I lager i butik", value: "Ingen butik hade den i lager vid senaste kontrollen.", inline: false });
  }
  const cheapest = stores[0];
  if (cm?.price) {
    const delta = cheapest ? marketDelta(cheapest.price, cm.price) : null;
    fields.push({
      name: "Marknadsvärde",
      value: delta ? `${formatMarketValue(delta)} (billigaste butik)` : formatPrice(cm.price),
      inline: false,
    });
  }
  const sold = index?.sold ? formatTraderaSold(index.sold[0], index.sold[1]) : null;
  if (sold) fields.push({ name: "Tradera sålt", value: sold, inline: false });

  const at = Date.parse(entry.prices.at);
  const productUrl = `${appUrl}/produkter/${entry.slug}`;
  const delta = cheapest && cm?.price ? marketDelta(cheapest.price, cm.price) : null;
  return {
    title: entry.title.length <= 256 ? entry.title : `${entry.title.slice(0, 255)}…`,
    url: productUrl,
    description:
      `${entry.set?.name ? `${entry.set.name} · ` : ""}` +
      `Priser och lager från ${Number.isFinite(at) ? `<t:${Math.floor(at / 1000)}:R>` : "senaste natten"}. ` +
      `[Prishistorik och alla butiker](${productUrl})`,
    color: delta ? (delta.verdict === "good" ? 0x22c55e : 0xef4444) : BRAND_COLOR,
    fields,
    ...(absolute(entry.imageUrl, appUrl) ? { thumbnail: { url: absolute(entry.imageUrl, appUrl)! } } : {}),
    footer: { text: "Foilio Pro · /pris" },
  };
}

/** Efemärt svar till den som inte har Pro-rollen. */
export function proRequiredMessage(appUrl: string) {
  return {
    content:
      `**/pris ingår i Foilio Pro.** Svenska butikers priser, marknadsvärde och Tradera sålt direkt här i Discord.\n` +
      `Se exempel i <#${priceChannelId()}>. Skaffa Pro på ${appUrl}/priser och koppla Discord under Inställningar → Kopplingar så får du Pro-rollen.`,
    flags: EPHEMERAL,
  };
}
