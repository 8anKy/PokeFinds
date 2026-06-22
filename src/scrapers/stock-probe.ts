/**
 * Lätt per-produkt lagerkoll för den frekventa restock-pollen (src/jobs/restock-poll.ts).
 * Slår bara mot EN produkts lager-endpoint (ingen katalog-skrapning) så pollen blir
 * snabb och billig. Stödjer butikerna vars offer-URL går att probea direkt:
 *   - Shopify:  {origin}{path}.json  → product.variants[].available
 *   - Webhallen: /api/product/{id}   → product.stock.web > 0
 * Okänt mönster → null (pollen hoppar över; den fulla 4h-skrapningen tar dem).
 */
import { StockStatus } from "@prisma/client";
import { politeFetch } from "./http";

type ProbeKind = "shopify" | "webhallen";
export interface ProbeTarget {
  kind: ProbeKind;
  fetchUrl: string;
}

/** Ren URL→probe-mappning (testbar utan nätverk). null = kan inte probea. */
export function probeTarget(offerUrl: string): ProbeTarget | null {
  let u: URL;
  try {
    u = new URL(offerUrl);
  } catch {
    return null;
  }
  if (u.host.includes("webhallen.com")) {
    const m = u.pathname.match(/\/product\/(\d+)/);
    return m ? { kind: "webhallen", fetchUrl: `https://www.webhallen.com/api/product/${m[1]}` } : null;
  }
  if (u.pathname.includes("/products/")) {
    return { kind: "shopify", fetchUrl: `${u.origin}${u.pathname}.json` };
  }
  return null;
}

interface ShopifyJson {
  product?: { variants?: { available?: boolean }[] };
}
interface WebhallenJson {
  product?: { stock?: { web?: number | null } | null };
}

/** Aktuell lagerstatus för en enskild offer-URL. null = okänd/kan inte probea. */
export async function probeStock(offerUrl: string): Promise<StockStatus | null> {
  const target = probeTarget(offerUrl);
  if (!target) return null;
  try {
    const res = await politeFetch(target.fetchUrl, {
      delayMs: 1000,
      retries: 2,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    if (target.kind === "shopify") {
      const json = (await res.json()) as ShopifyJson;
      const variants = json.product?.variants ?? [];
      return variants.some((v) => v.available) ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK;
    }
    const json = (await res.json()) as WebhallenJson;
    return (json.product?.stock?.web ?? 0) > 0 ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK;
  } catch {
    return null;
  }
}
