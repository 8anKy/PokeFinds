import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { ServiceError } from "@/lib/errors";
import {
  createTraderaListing,
  traderaCategoryId,
  traderaLanguageTerm,
  parseImage,
} from "@/lib/tradera-sell";

export const dynamic = "force-dynamic";

const CONDITION_LABELS: Record<string, string> = {
  MINT: "Mint",
  NEAR_MINT: "Near Mint",
  EXCELLENT: "Excellent",
  GOOD: "Good",
  PLAYED: "Played",
  POOR: "Poor",
  SEALED: "Sealed",
};

const schema = z.object({
  collectionItemId: z.string().min(1),
  priceKr: z.number().int().positive(),
  shippingKr: z.number().int().min(0),
  condition: z.string().optional(),
  purchasePriceKr: z.number().int().min(0).optional(), // vad användaren betalade (för vinstberäkning)
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
      throw new ServiceError(400, "Tradera-kopplingen har gått ut — anslut kontot igen.");
    }

    const input = schema.parse(await req.json());

    const item = await prisma.collectionItem.findFirst({
      where: { id: input.collectionItemId, userId: user.id },
      include: { card: { include: { set: true } }, product: true },
    });
    if (!item) throw new ServiceError(404, "Objektet hittades inte i din samling.");

    const isSingle = !!item.cardId;
    const name = item.card?.name ?? item.product?.title ?? item.notes ?? "Pokémon-kort";
    const setName = item.card?.set?.name ?? null;
    const number = item.card?.number ?? null;
    const conditionLabel =
      CONDITION_LABELS[input.condition ?? item.condition] ?? item.condition;

    const titleParts = [name, setName, number ? `#${number}` : null].filter(Boolean).join(" · ");
    const title = `${titleParts} · ${conditionLabel}`;

    const autoDescription = [
      `${name}${setName ? ` — ${setName}` : ""}${number ? ` (#${number})` : ""}`,
      `Skick: ${conditionLabel}`,
      isSingle ? "Språk: " + (traderaLanguageTerm(item.language) ?? item.language) : null,
      "",
      "Bilden visar det exakta objektet. Säljes av privatperson.",
    ]
      .filter((l) => l !== null)
      .join("\n");
    const description = input.description || autoDescription;

    const { url, itemId } = await createTraderaListing({
      userId: me.traderaUserId,
      token: me.traderaToken,
      title,
      description,
      categoryId: traderaCategoryId(item.product?.category ?? null, isSingle),
      priceKr: input.priceKr,
      shippingKr: input.shippingKr,
      languageTerm: isSingle ? traderaLanguageTerm(item.language) : undefined,
      images: input.imagesBase64.map(parseImage),
    });

    // Spara objektnr (→ sold-sync) + ev. inköpspris (→ vinstberäkning i Sålt-fliken).
    // Best-effort: annonsen är redan skapad, låt aldrig detta fälla svaret.
    const update: { traderaItemId?: string; purchasePrice?: number } = {};
    if (itemId) update.traderaItemId = itemId;
    if (input.purchasePriceKr != null) update.purchasePrice = input.purchasePriceKr * 100;
    if (Object.keys(update).length > 0) {
      await prisma.collectionItem
        .update({ where: { id: item.id }, data: update })
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
