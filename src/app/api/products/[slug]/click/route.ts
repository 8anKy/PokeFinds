import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { ServiceError } from "@/lib/errors";
import { trackEvent } from "@/services/analytics";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  offerId: z.string().min(1, "offerId krävs."),
});

/** Bygger utgående URL med affiliate-parametrar om återförsäljaren har det aktiverat. */
function buildOutboundUrl(url: string, affiliateParams: string | null): string {
  if (!affiliateParams) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${affiliateParams.replace(/^[?&]/, "")}`;
}

/**
 * Säkerställer att Cardmarket-URL:er har ?language=1 (engelska annonser).
 * Redirect-URL:er via prices.pokemontcg.io kan inte få language-param
 * (de redirectar till CM utan att skicka vidare query-params), men direkta
 * CM-URL:er får filtret tillagt.
 */
function ensureCmLanguageFilter(url: string): string {
  if (!url.includes("cardmarket.com/")) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("language")) {
      parsed.searchParams.set("language", "1");
      return parsed.toString();
    }
  } catch {
    // malformed URL — return as-is
  }
  return url;
}

export async function POST(
  req: Request,
  { params }: { params: { slug: string } }
) {
  try {
    const { offerId } = bodySchema.parse(await req.json());

    const offer = await prisma.offer.findUnique({
      where: { id: offerId },
      include: {
        product: { select: { id: true, slug: true } },
        retailer: {
          select: { id: true, affiliateEnabled: true, affiliateParams: true },
        },
      },
    });
    if (!offer || offer.product.slug !== params.slug) {
      throw new ServiceError(404, "Erbjudandet hittades inte.");
    }

    await prisma.product.update({
      where: { id: offer.product.id },
      data: { clickCount: { increment: 1 } },
    });
    await trackEvent("retailer_click", offer.product.id, {
      retailerId: offer.retailer.id,
      offerId: offer.id,
    });

    let url = offer.retailer.affiliateEnabled
      ? buildOutboundUrl(offer.url, offer.retailer.affiliateParams)
      : offer.url;

    // Cardmarket: säkerställ engelskt språkfilter
    url = ensureCmLanguageFilter(url);

    return jsonOk({ url });
  } catch (e) {
    return apiError(e);
  }
}
