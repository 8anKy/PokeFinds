/**
 * Flödets filter (ägarbeslut 2026-10-05): tre lägen i stället för en chiprad med
 * sex grupper, varav fyra aldrig fått ett inlägg. Grupperna finns kvar i databasen
 * (gamla inlägg behåller sin etikett, /forum/g/<slug> fungerar) men bara de
 * SYNLIGA erbjuds när man skriver ett nytt inlägg.
 */
export const FEED_MODES = ["all", "stores", "market"] as const;
export type FeedMode = (typeof FEED_MODES)[number];

export const MARKET_GROUP_SLUG = "kop-salj-byt";
/** Grupper man kan välja i skrivrutan. Övriga döljs tills ett ämne behöver dem. */
export const VISIBLE_GROUP_SLUGS = ["allmant", MARKET_GROUP_SLUG] as const;

/**
 * "Bara färska fynd" cachas i 10-minutersfack: flödet ligger i en delad cache
 * (1 h), och utan facket hade en rapport som blivit gammal legat kvar i filtret
 * hela timmen. Facket ingår i cachenyckeln, så träffen åldras med klockan.
 */
export const FRESH_BUCKET_MS = 10 * 60 * 1000;
export function freshBucket(now = Date.now()): number {
  return Math.floor(now / FRESH_BUCKET_MS);
}

/** API-frågan för ett läge (null = det förrenderade "Allt"-flödet). */
export function feedModeQuery(mode: FeedMode, freshOnly: boolean): string | null {
  if (mode === "stores") return freshOnly ? "reports=1&fresh=1" : "reports=1";
  if (mode === "market") return `group=${MARKET_GROUP_SLUG}`;
  return null;
}
