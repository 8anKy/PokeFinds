/**
 * POST /api/scanner/identify — LIVE kortidentifiering.
 *
 * Till skillnad från /upload skapar detta INGET ScannerJob (ingen DB-skrivning
 * per ruta) — det är tänkt att pollas med nedskalade videorutor medan användaren
 * håller upp ett kort. Returnerar bästa katalogträffar + aktuellt marknadsvärde.
 */
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { identifyCard } from "@/services/scanner";

export const dynamic = "force-dynamic";

/** Live-rutor är nedskalade på klienten — taket är generöst men begränsat. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const schema = z.object({
  image: z
    .string()
    .min(1, "Bild saknas.")
    .regex(/^data:image\/[a-z+.-]+;base64,/i, "Bilden måste vara en data-URL (image/*)."),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();

    // Live-flödet pollar ~var 1,5 s → generös men begränsad kvot (skydd mot missbruk/kostnad).
    const { ok } = await rateLimit(`scanner-identify:${user.id}`, 120, 60 * 1000);
    if (!ok) {
      throw new ServiceError(429, "För många skanningar på kort tid — vänta en stund.");
    }

    const { image } = schema.parse(await req.json());
    if (image.length > MAX_IMAGE_BYTES * 1.4) {
      throw new ServiceError(413, "Bilden är för stor. Skala ner videorutan innan den skickas.");
    }

    const result = await identifyCard(image);
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}
