/**
 * GRADERADE SÅLDA PÅ EBAY — via prisleverantörens `ebay-sold-offers` (2026-09-15).
 *
 * Leverantören (samma RapidAPI-nyckel som Cardmarket-priserna) exponerar eBay
 * UK:s avslutade graderade annonser per kort, redan matchade på `tcgid`
 * (pokemontcg-id) eller `cardmarket_id`. Vi hämtar de INDIVIDUELLA affärerna
 * (inte deras median) och lägger dem i `GradedSale` med `source: "ebay"` —
 * då får medianen, urvalsantalet och grafens sålt-punkter samma väg som
 * Tradera-affärerna, och de två marknaderna hålls isär på `source`.
 *
 * ⛔ BEGÄRT ÄR INTE SÅLT: det här är avslutade affärer; de begärda ligger i
 *    GradedAsk. ⛔ eBay UK ≠ Tradera: egen etikett, egen serie, aldrig ett
 *    sammanslaget tal. ⛔ GBP → öre via priceOreFromGbp (nollvakt), aldrig bar
 *    multiplikation. ⛔ Ett bolag vi inte känner blir OTHER, ett betyg som inte
 *    går att läsa gör raden ogiltig (hellre tappad än fel).
 *
 * Ren modul (ingen DB, ingen nätverk) så domen kan testas; klienten ligger i
 * jobs/ebay-sold-sweep.ts.
 */
import { type RatesOre, priceOreFromEur, priceOreFromGbp, priceOreFromUsd } from "@/lib/exchange-rate";
import type { GradingIssuer } from "@/lib/graded-listing";

export const EBAY_SOLD_SOURCE = "ebay";

export interface EbaySoldOffer {
  ebay_item_id: string;
  title: string;
  price: number;
  currency: string;
  company: string;
  grade: string;
  image_url?: string | null;
  url: string;
  ended_at: string;
}

export interface EbaySoldRow {
  itemId: string;
  issuer: GradingIssuer;
  gradeTenths: number;
  /** Öre (konverterat). */
  price: number;
  title: string;
  url: string;
  soldAt: Date;
}

const ISSUERS: Record<string, GradingIssuer> = {
  PSA: "PSA", BGS: "BGS", BECKETT: "BGS", CGC: "CGC", SGC: "SGC", ACE: "ACE", TAG: "TAG",
  HGA: "HGA", GMA: "GMA", ISA: "ISA", AGS: "AGS", GG: "GG", RAUKCARD: "RAUKCARD",
};

/** "9.5" → 95, "10" → 100. null när det inte är ett betyg 1–10 i halva steg. */
export function parseGradeTenths(grade: string | null | undefined): number | null {
  if (!grade) return null;
  const n = Number(String(grade).trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 1 || n > 10) return null;
  const tenths = Math.round(n * 10);
  return tenths % 5 === 0 ? tenths : null;
}

export function priceOreFromCurrency(
  amount: number,
  currency: string,
  rates: Pick<RatesOre, "eurToOre" | "usdToOre" | "gbpToOre">
): number | null {
  switch (currency.toUpperCase()) {
    case "GBP": return priceOreFromGbp(amount, rates);
    case "USD": return priceOreFromUsd(amount, rates);
    case "EUR": return priceOreFromEur(amount, rates);
    case "SEK": return amount > 0 ? Math.round(amount * 100) : null;
    default: return null;
  }
}

/**
 * En leverantörsrad → en GradedSale-rad, eller null när den inte bevisar sig
 * (okänt betyg, nollpris, okänd valuta, trasigt datum).
 */
export function mapEbaySoldOffer(o: EbaySoldOffer, rates: RatesOre): EbaySoldRow | null {
  if (!o.ebay_item_id || !o.url || !o.title) return null;
  const gradeTenths = parseGradeTenths(o.grade);
  if (gradeTenths == null) return null;
  const price = priceOreFromCurrency(o.price, o.currency ?? "", rates);
  if (price == null) return null;
  const soldAt = new Date(o.ended_at);
  if (!Number.isFinite(soldAt.getTime())) return null;
  return {
    // Prefix så nyckeln aldrig krockar med Traderas annons-id i samma kolumn.
    itemId: `${EBAY_SOLD_SOURCE}:${o.ebay_item_id}`,
    issuer: ISSUERS[o.company?.toUpperCase()] ?? "OTHER",
    gradeTenths,
    price,
    title: o.title.slice(0, 300),
    url: o.url,
    soldAt,
  };
}
