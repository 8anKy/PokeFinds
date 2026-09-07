import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { ServiceError } from "@/lib/errors";
import { readJsonCapped } from "@/lib/body-limit";
import {
  createTraderaListing,
  traderaCategoryId,
  traderaLanguageTerm,
  parseImage,
} from "@/lib/tradera-sell";
import {
  AUCTION_DURATIONS,
  BUY_NOW_DURATION_DAYS,
  DEFAULT_AUCTION_DURATION,
  ITEM_TYPE_AUCTION,
  ITEM_TYPE_BUY_NOW,
  conditionLabel,
} from "@/lib/tradera-listing-options";

export const dynamic = "force-dynamic";

/**
 * Hårt body-tak, verkställs INNAN kroppen buffras. Klienten skalar foton till
 * 1600 px JPEG (~0,2–0,6 MB styck), så 32 MB täcker 12 ovanligt stora foton
 * med bred marginal — schemat ensamt tillät ~96 MB att buffras först.
 */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

const schema = z.object({
  collectionItemId: z.string().min(1),
  /** Köp nu-pris. För en auktion är det ett VALFRITT "köp direkt"-pris. */
  priceKr: z.number().int().positive().optional(),
  /** Auktionens utgångspris. Krävs när listingType = AUCTION. */
  startPriceKr: z.number().int().positive().optional(),
  listingType: z.enum(["BUY_NOW", "AUCTION"]).default("BUY_NOW"),
  /** Auktionens löptid i dagar. Köp nu ligger alltid 60 dagar. */
  durationDays: z
    .number()
    .int()
    .refine((d) => (AUCTION_DURATIONS as readonly number[]).includes(d), "Ogiltig löptid.")
    .optional(),
  /**
   * Ett eller flera fraktsätt. Utan `productId` är raden "eget belopp"
   * (Traderas Alternative), annars ett riktigt fraktbolag ur
   * /api/tradera/shipping-options.
   */
  shippingOptions: z
    .array(
      z.object({
        costKr: z.number().int().min(0),
        productId: z.number().int().positive().optional(),
        providerId: z.number().int().positive().optional(),
        weightKg: z.number().positive().max(50).optional(),
      })
    )
    .min(1, "Välj minst ett fraktsätt.")
    .max(8),
  /** Momssats i procent — bara för den som redovisar moms. */
  vatPercent: z
    .number()
    .int()
    .refine((v) => [0, 6, 12, 25].includes(v), "Ogiltig momssats.")
    .optional(),
  condition: z.string().optional(),
  description: z.string().trim().max(4000).optional(), // egen text; annars auto-genererad
  // data:-URL:er med foton på det egna objektet (första = huvudbild). Tradera tar max 12.
  // max 8M tecken/bild (≈6 MB binärt) — utan tak kan en inloggad användare POSTa obegränsat stora bodies.
  imagesBase64: z.array(z.string().min(100).max(8_000_000)).min(1).max(12),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const me = await prisma.user.findUnique({
      where: { id: user.id },
      select: { traderaUserId: true, traderaToken: true, traderaTokenExpiresAt: true },
    });
    if (!me?.traderaUserId || !me.traderaToken) {
      throw new ServiceError(400, "Anslut ditt Tradera-konto först (Inställningar).");
    }
    if (me.traderaTokenExpiresAt && me.traderaTokenExpiresAt < new Date()) {
      throw new ServiceError(400, "Tradera-kopplingen har gått ut. Anslut kontot igen.");
    }

    const input = schema.parse(await readJsonCapped(req, MAX_BODY_BYTES));

    const item = await prisma.collectionItem.findFirst({
      where: { id: input.collectionItemId, userId: user.id },
      include: { card: { include: { set: true } }, product: true },
    });
    if (!item) throw new ServiceError(404, "Objektet hittades inte i din samling.");

    const isSingle = !!item.cardId;
    const name = item.card?.name ?? item.product?.title ?? item.notes ?? "Pokémon-kort";
    const setName = item.card?.set?.name ?? null;
    const number = item.card?.number ?? null;
    const condLabel = conditionLabel(input.condition ?? item.condition, isSingle);

    const titleParts = [name, setName, number ? `#${number}` : null].filter(Boolean).join(" · ");
    const title = `${titleParts} · ${condLabel}`;

    const autoDescription = [
      `${name}${setName ? `, ${setName}` : ""}${number ? ` (#${number})` : ""}`,
      `Skick: ${condLabel}`,
      isSingle ? "Språk: " + (traderaLanguageTerm(item.language) ?? item.language) : null,
      "",
      "Bilden visar det exakta objektet. Säljes av privatperson.",
    ]
      .filter((l) => l !== null)
      .join("\n");
    const description = input.description || autoDescription;

    // Prisdomen bor HÄR, inte i klienten: en auktion utan utgångspris och en
    // Köp nu utan pris är båda annonser ingen kan köpa.
    const isAuction = input.listingType === "AUCTION";
    if (isAuction && input.startPriceKr == null) {
      throw new ServiceError(400, "Ange ett utgångspris för auktionen.");
    }
    if (!isAuction && input.priceKr == null) {
      throw new ServiceError(400, "Ange ett pris för annonsen.");
    }
    if (isAuction && input.priceKr != null && input.priceKr <= input.startPriceKr!) {
      throw new ServiceError(400, "Köp direkt-priset måste vara högre än utgångspriset.");
    }

    const { url, itemId } = await createTraderaListing({
      userId: me.traderaUserId,
      token: me.traderaToken,
      title,
      description,
      categoryId: traderaCategoryId(item.product?.category ?? null, isSingle),
      itemType: isAuction ? ITEM_TYPE_AUCTION : ITEM_TYPE_BUY_NOW,
      durationDays: isAuction
        ? (input.durationDays ?? DEFAULT_AUCTION_DURATION)
        : BUY_NOW_DURATION_DAYS,
      priceKr: input.priceKr,
      startPriceKr: isAuction ? input.startPriceKr : undefined,
      shipping: input.shippingOptions.map((o) => ({
        costKr: o.costKr,
        productId: o.productId,
        providerId: o.providerId,
        weightKg: o.weightKg,
      })),
      vatPercent: input.vatPercent,
      languageTerm: isSingle ? traderaLanguageTerm(item.language) : undefined,
      images: input.imagesBase64.map(parseImage),
    });

    // Spara objektnr (→ sold-sync). Best-effort: annonsen är redan skapad, låt
    // aldrig detta fälla svaret. ⛔ Inköpspriset sätts INTE här längre — det är
    // portföljens fält och frågades i säljformuläret bara för att det råkade
    // ligga nära; den som säljer vill ange ett SÄLJpris (ägarbeslut 2026-09-07).
    if (itemId) {
      await prisma.collectionItem
        .update({ where: { id: item.id }, data: { traderaItemId: itemId } })
        .catch((e) => console.error("[tradera-sell] kunde inte spara annons-metadata:", e));
    }

    return jsonOk({ url });
  } catch (e) {
    // Tradera-API-fel (Error) → 502 med meddelande så användaren ser vad som hände.
    if (e instanceof Error && e.message.startsWith("Tradera ")) {
      return apiError(new ServiceError(502, e.message));
    }
    return apiError(e);
  }
}
