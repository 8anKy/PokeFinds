/**
 * "Till salu på Tradera" på profilsidan — en säljares AKTIVA Pokémon-annonser,
 * hämtade ur Traderas PublicService (SOAP v3, `GetSellerItems`).
 *
 * Självständig med flit: `src/jobs/tradera-sweep.ts` har egna SOAP-hjälpare men
 * drar in Prisma, matchning och hela jobbmaskineriet — en profilsida ska inte
 * importera ett nattjobb. Formen här är avsiktligt liten: ETT anrop, en ren
 * parser, ingen databas.
 *
 * KONTRAKTET (verifierat mot https://api.tradera.com/v3/PublicService.asmx?WSDL
 * och mot LIVE-svar 2026-09-03):
 *   · `GetSellerItems(userId, categoryId, filterActive, minEndDate?, maxEndDate?,
 *     filterItemType)` — `filterActive` ∈ ActiveFilter {All, Active, Inactive},
 *     `filterItemType` ∈ ItemTypeFilter {All, Auction, PureBuyItNow, ShopItem}.
 *     Svepet skickar `PureBuyItNow` för att det bara vill ha fasta priser; här
 *     vill vi ha ALLT som är aktivt ⇒ `All`.
 *   · ⛔ `categoryId` FILTRERAR INTE SOM MAN TROR. Mätt 2026-09-03: en säljare
 *     med en aktiv annons vars `CategoryId` = 1001337 gav TOMT svar för
 *     `categoryId=1001337` (med All, PureBuyItNow OCH filterActive=All), men
 *     `categoryId=0` gav alla 260 aktiva annonser med rätt `CategoryId` per rad.
 *     Därför: ett anrop med 0 och kategorifiltret i parsern. (Svepets Fas 2
 *     skickar kategori-id — den vägen ger med all sannolikhet noll rader.)
 *   · Svaret är `ArrayOfItem` med `<Item>`-element (bekräftat live). `Item` bär
 *     `ItemType` {Auction, PureBuyItNow, ShopItem, ContactOnly}, `Status{Ended,
 *     GotBidders, GotWinner}`, `EndDate` (med tidszon, +02:00), `CategoryId`,
 *     `OpeningBid`, `BuyItNowPrice`, `NextBid`, `MaxBid`, `TotalBids`,
 *     `ItemLink`, `ThumbnailLink`, `ImageLinks`, `LongDescription` (⇒ ~4 kB per
 *     annons; en storsäljare ger några MB). Det finns INGET `IsEnded`/`HasBids`
 *     i typen (SearchService har dem) — parsern läser `Status/Ended` och tål båda.
 *
 * KOSTNAD: noll Neon. Traderas kvot är 10 000 anrop/dygn/metod; med cachen
 * nedan (15 min per Tradera-id) är taket 4 anrop per visad profil och timme.
 * Alla fel sväljs till `[]` — profilen får aldrig falla för att Tradera ligger.
 */
import { cachedRead, STATIC_CACHE_TAG } from "@/lib/cache";

export interface SellerListing {
  itemId: string;
  title: string;
  /** Aktuellt pris i öre: Köp nu-priset, eller för auktioner ledande bud/utrop. `null` = okänt. */
  priceOre: number | null;
  url: string;
  imageUrl: string | null;
  /** ISO-sträng (cachen JSON-serialiserar — därför aldrig ett Date-objekt). */
  endsAt: string | null;
  itemType: "auction" | "buyNow" | "other";
}

const PUBLIC_API = "https://api.tradera.com/v3/publicservice.asmx";
const SOAP_ACTION_NS = "http://api.tradera.com";
const CALL_TIMEOUT_MS = 8_000;

/**
 * Traderas Pokémon-kategoriträd — samma ids som svepet, tradera-sell.ts och
 * marketplace-urls.ts (löskort, boosterpaket, boosterboxar, övrigt sealed).
 * ⚠️ Live-svaret 2026-09-03 innehöll även 1001342/1001343/1001393 hos en säljare
 * med Pokémon-kort; vad de är (graderat? tillbehör? annat TCG?) är OMÄTT, så de
 * står utanför tills någon slagit upp dem — hellre ett kort för lite än ett
 * Magic-kort under "Till salu på Tradera".
 */
export const TRADERA_POKEMON_CATEGORY_IDS: ReadonlySet<number> = new Set([
  1001337, 1001339, 1001340, 1001341,
]);
/** Fler än så här visar profilen ändå aldrig; taket håller cacheposten liten. */
export const MAX_SELLER_LISTINGS = 24;

// Samma citat-strippning som tradera-sell.ts: värdena klistras ibland in med
// citattecken i Railway/Actions, och ett citattecken i appKey ger 401, tyst.
const stripQuotes = (v: string) => v.trim().replace(/^["']|["']$/g, "");

function credentials(): { appId: string; appKey: string } | null {
  const appId = stripQuotes(process.env.TRADERA_APP_ID ?? "");
  const appKey = stripQuotes(process.env.TRADERA_APP_KEY ?? "");
  return appId && appKey ? { appId, appKey } : null;
}

/** Publik sida med säljarens alla annonser (aliaset i URL:en är valfritt — bar id fungerar). */
export function traderaSellerProfileUrl(traderaUserId: string): string {
  return `https://www.tradera.com/profile/items/${encodeURIComponent(traderaUserId)}/`;
}

// ─── XML-hjälpare (samma stil som svepets, medvetet kopierade — inte delade) ──

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function tagText(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
  if (!m) return undefined;
  const v = decodeEntities(m[1].trim());
  return v.length > 0 ? v : undefined;
}

/** Hela kronor > 0, annars null. Tradera skickar priser som heltal (xs:int). */
function positiveKr(block: string, name: string): number | null {
  const raw = tagText(block, name);
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function firstPositiveKr(block: string, names: string[]): number | null {
  for (const name of names) {
    const v = positiveKr(block, name);
    if (v != null) return v;
  }
  return null;
}

function itemBlocks(xml: string): string[] {
  // WSDL-formen (och den uppmätta): `<Item>…</Item>` i ArrayOfItem. SearchService-
  // formen, som svepet parsar, lägger varje träff i `<Items>…</Items>` — tål båda
  // så ett framtida formbyte inte tömmer profilen tyst. `<Item>` matchar aldrig
  // `<ItemType>`/`<ItemLink>`: regexen kräver `>` direkt efter namnet.
  const single = [...xml.matchAll(/<Item>([\s\S]*?)<\/Item>/g)].map((m) => m[1]);
  if (single.length > 0) return single;
  return [...xml.matchAll(/<Items>([\s\S]*?)<\/Items>/g)].map((m) => m[1]);
}

function firstImageLink(block: string): string | undefined {
  // `<ImageLinks><string>https://…</string>…` — första posten är huvudbilden.
  const m = block.match(/<ImageLinks>[\s\S]*?<string>([^<]*)<\/string>/);
  const v = m ? decodeEntities(m[1].trim()) : "";
  return v.length > 0 ? v : undefined;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

export interface ParseSellerItemsOptions {
  /** Klockan — allt med EndDate före den räknas som avslutat. Default nu. */
  now?: number;
  /** Behåll bara annonser vars `CategoryId` finns här. Utelämnad = alla kategorier. */
  categoryIds?: ReadonlySet<number> | null;
}

/**
 * Ren parser av ett GetSellerItems-svar. Avslutade annonser hoppas över (Status/
 * Ended, IsEnded eller ett EndDate som passerat); med `categoryIds` faller allt
 * utanför Pokémon-trädet bort (svaret för categoryId=0 är säljarens HELA lager).
 */
export function parseSellerItemsXml(
  xml: string,
  opts: ParseSellerItemsOptions = {}
): SellerListing[] {
  const now = opts.now ?? Date.now();
  const listings: SellerListing[] = [];

  for (const block of itemBlocks(xml)) {
    const itemId = tagText(block, "Id");
    const title = tagText(block, "ShortDescription");
    if (!itemId || !title) continue;

    if (opts.categoryIds) {
      const cat = Number.parseInt(tagText(block, "CategoryId") ?? "", 10);
      if (!opts.categoryIds.has(cat)) continue;
    }

    const statusBlock = block.match(/<Status>([\s\S]*?)<\/Status>/)?.[1] ?? "";
    if (tagText(statusBlock, "Ended") === "true" || tagText(block, "IsEnded") === "true") continue;

    const endRaw = tagText(block, "EndDate");
    const endMs = endRaw ? Date.parse(endRaw) : NaN;
    if (Number.isFinite(endMs) && endMs <= now) continue;
    const endsAt = Number.isFinite(endMs) ? new Date(endMs).toISOString() : null;

    const rawType = tagText(block, "ItemType") ?? "";
    const itemType: SellerListing["itemType"] =
      rawType === "Auction"
        ? "auction"
        : rawType === "PureBuyItNow" || rawType === "ShopItem"
          ? "buyNow"
          : "other";

    // Auktion: ledande budet (MaxBid) när någon bjudit, annars utropet. Köp nu:
    // bara BuyItNowPrice — saknas det vet vi inte priset, och "–" är ärligare
    // än ett utrop som inte gäller. Aldrig 0 kr (positiveKr).
    const totalBids = Number.parseInt(tagText(block, "TotalBids") ?? "0", 10) || 0;
    let kr: number | null;
    if (itemType === "auction") {
      kr = firstPositiveKr(
        block,
        totalBids > 0 ? ["MaxBid", "NextBid", "OpeningBid"] : ["OpeningBid", "NextBid", "MaxBid"]
      );
    } else {
      kr = positiveKr(block, "BuyItNowPrice");
    }

    const rawUrl = tagText(block, "ItemLink") ?? tagText(block, "ItemUrl");
    // Samma vakt som svepet: länkfältet har burit bild-URL:er. Allt som inte är
    // en annons-länk faller tillbaka på den konstruerade item-URL:en.
    const url =
      rawUrl && /tradera\.com\/item\//.test(rawUrl)
        ? rawUrl.replace(/^http:\/\//, "https://")
        : `https://www.tradera.com/item/0/${itemId}/`;

    // /thumbs/ = 64×64, oanvändbart i ett rutnät; samma CDN serverar /medium-fit/.
    const thumb = tagText(block, "ThumbnailLink")?.replace("/thumbs/", "/medium-fit/");
    const image = thumb && /^https?:\/\//.test(thumb) ? thumb : firstImageLink(block);

    listings.push({
      itemId,
      title,
      priceOre: kr != null ? kr * 100 : null,
      url,
      imageUrl: image && /^https?:\/\//.test(image) ? image : null,
      endsAt,
      itemType,
    });
  }

  return listings;
}

/** Dedup på itemId, snarast avslutande först (okänt slut sist), tak. */
export function mergeSellerListings(
  lists: SellerListing[][],
  max: number = MAX_SELLER_LISTINGS
): SellerListing[] {
  const byId = new Map<string, SellerListing>();
  for (const list of lists) {
    for (const item of list) if (!byId.has(item.itemId)) byId.set(item.itemId, item);
  }
  return [...byId.values()]
    .sort((a, b) => {
      if (a.endsAt === b.endsAt) return 0;
      if (a.endsAt === null) return 1;
      if (b.endsAt === null) return -1;
      return a.endsAt < b.endsAt ? -1 : 1;
    })
    .slice(0, max);
}

// ─── SOAP ────────────────────────────────────────────────────────────────────

async function callGetSellerItems(
  creds: { appId: string; appKey: string },
  userId: number
): Promise<string> {
  // categoryId=0 = alla kategorier — se filhuvudet för varför inte Pokémon-id:na.
  const body =
    `<?xml version="1.0"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:trad="${SOAP_ACTION_NS}">` +
    `<soap:Header>` +
    `<trad:AuthenticationHeader><trad:AppId>${creds.appId}</trad:AppId><trad:AppKey>${creds.appKey}</trad:AppKey></trad:AuthenticationHeader>` +
    `<trad:ConfigurationHeader><trad:Sandbox>0</trad:Sandbox><trad:MaxResultAge>0</trad:MaxResultAge></trad:ConfigurationHeader>` +
    `</soap:Header>` +
    `<soap:Body><trad:GetSellerItems>` +
    `<trad:userId>${userId}</trad:userId>` +
    `<trad:categoryId>0</trad:categoryId>` +
    `<trad:filterActive>Active</trad:filterActive>` +
    `<trad:filterItemType>All</trad:filterItemType>` +
    `</trad:GetSellerItems></soap:Body></soap:Envelope>`;

  const res = await fetch(`${PUBLIC_API}?appId=${creds.appId}&appKey=${creds.appKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"${SOAP_ACTION_NS}/GetSellerItems"`,
    },
    body,
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const xml = await res.text();
  if (/<soap:Fault>|<s:Fault>|<faultstring>/.test(xml)) {
    throw new Error(`SOAP-fel: ${(xml.match(/<faultstring>([^<]*)</)?.[1] ?? "").slice(0, 200)}`);
  }
  return xml;
}

/**
 * Säljarens aktiva Pokémon-annonser. Kastar aldrig: saknade nycklar, ogiltigt id,
 * timeout eller ett trasigt svar ger `[]` (och en varning i loggen).
 */
export async function fetchTraderaSellerListings(traderaUserId: string): Promise<SellerListing[]> {
  const creds = credentials();
  if (!creds) return [];
  const userId = Number.parseInt(traderaUserId, 10);
  if (!Number.isFinite(userId) || userId <= 0) return [];

  try {
    const xml = await callGetSellerItems(creds, userId);
    const listings = parseSellerItemsXml(xml, { categoryIds: TRADERA_POKEMON_CATEGORY_IDS });
    return mergeSellerListings([listings], MAX_SELLER_LISTINGS);
  } catch (err) {
    console.warn(
      `[tradera-seller-items] GetSellerItems ${userId} misslyckades: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return [];
  }
}

/**
 * Cachefönstret. Var 1 h; sänkt till 15 min 2026-09-03 när ägaren lade upp en
 * annons och profilen fortsatte visa den tomma listan som cachats strax innan.
 * Kostnaden är BARA Tradera-anrop (10 000/dygn/metod), noll Neon — en profil
 * som visas oavbrutet ger 96 anrop/dygn.
 */
const TRADERA_SELLER_ITEMS_TTL_S = 900;

/**
 * Egen tagg så att inställningsreglaget kan KASTA posten när ägaren slår på
 * visningen (/api/users/me PATCH → revalidateTag): utan den hade en profil som
 * visades med reglaget av fortsatt visa "inga annonser" tills fönstret löpt ut.
 */
export const TRADERA_SELLER_ITEMS_TAG = "tradera-seller-items";

/**
 * En Tradera-rundtur per profil och kvart. `STATIC_CACHE_TAG`: posten bär
 * Tradera-priser, inte katalogpriser — prisjobbens revalidering ska inte kasta den.
 * Returtypen är ren JSON (strängar/tal/null) eftersom unstable_cache serialiserar.
 */
export const getTraderaSellerListingsCached = cachedRead(
  fetchTraderaSellerListings,
  "tradera-seller-items",
  TRADERA_SELLER_ITEMS_TTL_S,
  [STATIC_CACHE_TAG, TRADERA_SELLER_ITEMS_TAG]
);
