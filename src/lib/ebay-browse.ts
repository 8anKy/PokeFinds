/**
 * eBay Browse API — minsta möjliga klient för graderade begärda priser.
 *
 * GRATIS PÅ VILLKOR: appen får ~5 000 Browse-anrop/dygn med en vanlig
 * utvecklarnyckel (client credentials, ingen användarinloggning). Vi använder
 * ETT anrop per kort (`item_summary/search`, aspekten `Graded:{Yes}` i
 * kategorin CCG Individual Cards 183454) och bucketar svaret per bolag/betyg
 * i `lib/graded-ask.ts`. Kvoten är alltså kort per dygn, inte betyg per dygn.
 *
 * ⛔ TOKEN ÄR EN APP-TOKEN (client_credentials, scope `api_scope`) — den räcker
 * för Browse och kräver ingen användare. Cachas i minnet till ~1 min före utgång.
 *
 * ⛔ 429 = STOPP, INTE RETRY. Dygnskvoten återställs vid midnatt Pacific; ett
 * jobb som studsar vidare efter 429 bränner bara runner-minuter. `EbayQuotaError`
 * kastas så svepet kan avsluta snyggt och skriva det det hann.
 *
 * `EBAY_ENV=sandbox` pekar mot sandlådan (egna nycklar, påhittad data) — bra för
 * att prova flödet innan produktionsnycklarna är verifierade.
 */
import type { EbayItemSummary } from "./graded-ask";

const HOSTS = {
  production: "https://api.ebay.com",
  sandbox: "https://api.sandbox.ebay.com",
} as const;

/** CCG Individual Cards — Pokémon-singlar bor här på alla eBay-marknader. */
export const EBAY_CCG_SINGLES_CATEGORY = "183454";

export class EbayQuotaError extends Error {
  constructor(msg = "eBay Browse: kvoten är slut (429)") {
    super(msg);
    this.name = "EbayQuotaError";
  }
}

export interface EbayBrowseConfig {
  clientId: string;
  clientSecret: string;
  env?: "production" | "sandbox";
  /** T.ex. EBAY_US (USD, störst graderat utbud). */
  marketplaceId?: string;
  /** Bara annonser som kan levereras hit (eBays `deliveryCountry`-filter). */
  deliveryCountry?: string | null;
  fetchImpl?: typeof fetch;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

export class EbayBrowseClient {
  private readonly base: string;
  private readonly marketplaceId: string;
  private readonly deliveryCountry: string | null;
  private readonly fetchImpl: typeof fetch;
  private tokenCache: TokenCache | null = null;
  /** Antal sök-anrop som gjorts (räknas mot dygnskvoten). */
  searchCalls = 0;

  constructor(private readonly cfg: EbayBrowseConfig) {
    this.base = HOSTS[cfg.env ?? "production"];
    this.marketplaceId = cfg.marketplaceId ?? "EBAY_US";
    this.deliveryCountry = cfg.deliveryCountry === undefined ? "SE" : cfg.deliveryCountry;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async getToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) return this.tokenCache.token;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    });
    const r = await this.fetchImpl(`${this.base}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!r.ok) {
      throw new Error(`eBay OAuth ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
    const j = (await r.json()) as { access_token: string; expires_in: number };
    this.tokenCache = {
      token: j.access_token,
      expiresAt: Date.now() + Math.max(60, j.expires_in - 60) * 1000,
    };
    return j.access_token;
  }

  /**
   * Aktiva GRADERADE annonser för en sökning, billigast först.
   * `limit` max 200 (eBays tak per sida); vi läser bara sida 1 — det är de
   * billigaste vi vill ha, och sorteringen är på pris.
   */
  async searchGraded(query: string, opts: { limit?: number } = {}): Promise<EbayItemSummary[]> {
    const token = await this.getToken();
    const params = new URLSearchParams({
      q: query,
      category_ids: EBAY_CCG_SINGLES_CATEGORY,
      aspect_filter: `categoryId:${EBAY_CCG_SINGLES_CATEGORY},Graded:{Yes}`,
      sort: "price",
      limit: String(Math.min(200, Math.max(1, opts.limit ?? 200))),
    });
    const filters = ["buyingOptions:{FIXED_PRICE}"];
    if (this.deliveryCountry) filters.push(`deliveryCountry:${this.deliveryCountry}`);
    params.set("filter", filters.join(","));

    const url = `${this.base}/buy/browse/v1/item_summary/search?${params.toString()}`;
    this.searchCalls++;
    const r = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": this.marketplaceId,
        Accept: "application/json",
      },
    });
    if (r.status === 429) throw new EbayQuotaError();
    if (r.status === 401) {
      // Token dog i förtid — hämta ny EN gång, sedan ge upp.
      this.tokenCache = null;
      const t2 = await this.getToken();
      const r2 = await this.fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${t2}`,
          "X-EBAY-C-MARKETPLACE-ID": this.marketplaceId,
          Accept: "application/json",
        },
      });
      if (r2.status === 429) throw new EbayQuotaError();
      if (!r2.ok) throw new Error(`eBay Browse ${r2.status}`);
      return summaries(await r2.json());
    }
    if (!r.ok) throw new Error(`eBay Browse ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return summaries(await r.json());
  }
}

function summaries(j: unknown): EbayItemSummary[] {
  const arr = (j as { itemSummaries?: unknown[] })?.itemSummaries;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => x as Record<string, unknown>)
    .filter((x) => typeof x.itemId === "string" && typeof x.title === "string")
    .map((x) => ({
      itemId: x.itemId as string,
      title: x.title as string,
      price: (x.price as EbayItemSummary["price"]) ?? null,
      itemWebUrl: typeof x.itemWebUrl === "string" ? x.itemWebUrl : undefined,
      buyingOptions: Array.isArray(x.buyingOptions) ? (x.buyingOptions as string[]) : undefined,
    }));
}

/** Klient ur env, eller null när nycklarna saknas (jobbet hoppar då över). */
export function ebayClientFromEnv(): EbayBrowseClient | null {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const env = process.env.EBAY_ENV === "sandbox" ? "sandbox" : "production";
  const dc = process.env.EBAY_DELIVERY_COUNTRY;
  return new EbayBrowseClient({
    clientId,
    clientSecret,
    env,
    marketplaceId: process.env.EBAY_MARKETPLACE_ID || "EBAY_US",
    // Tom sträng = inget leveransfilter (hela utbudet); osatt = SE.
    deliveryCountry: dc === undefined ? "SE" : dc || null,
  });
}
