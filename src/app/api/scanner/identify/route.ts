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
import { effectivePlanTier, isPro } from "@/lib/plan";
import { ServiceError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { getScannerQuota, identifyCard, isIntroScan, recordScanUsage } from "@/services/scanner";

export const dynamic = "force-dynamic";

/** Live-rutor är nedskalade på klienten — taket är generöst men begränsat. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const schema = z.object({
  image: z
    .string()
    .min(1, "Bild saknas.")
    .regex(/^data:image\/[a-z+.-]+;base64,/i, "Bilden måste vara en data-URL (image/*)."),
  // Starkare (dyrare) vision-modell — körs bara vid bekräftelse/uppladdning,
  // inte för varje live-ruta.
  precise: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();

    // Live-flödet pollar ~var 1,5 s (= ~40/min) → 60/min ger marginal men halverar
    // värsta-fallet (varje anrop = Claude vision = kostnad). OBS: rate-limit är
    // in-memory utan Redis → per-instans/svag på serverless. Hård budget-spärr =
    // Anthropic-kontots spend limit (sätt i konsolen) + ev. Upstash/Redis för äkta
    // distribuerad gräns. Se docs/LAUNCH-CHECKLIST.md Section 0.
    const { ok } = await rateLimit(`scanner-identify:${user.id}`, 60, 60 * 1000);
    if (!ok) {
      throw new ServiceError(429, "För många skanningar på kort tid — vänta en stund.");
    }

    const { image, precise } = schema.parse(await req.json());
    if (image.length > MAX_IMAGE_BYTES * 1.4) {
      throw new ServiceError(413, "Bilden är för stor. Skala ner videorutan innan den skickas.");
    }

    // Månadskvot (binder vision-kostnaden mot Pro-priset). No-match räknas inte.
    const quota = await getScannerQuota(user.id, effectivePlanTier(user));
    if (quota.remaining <= 0) {
      throw new ServiceError(
        429,
        isPro(user)
          ? `Du har nått månadens gräns på ${quota.limit} skanningar. Tillbaka nästa månad.`
          : `Du har använt dina ${quota.limit} gratis skanningar denna månad. Uppgradera till Pro för fler.`
      );
    }

    // Standard = billiga Haiku-modellen. Sonnet (precise) körs när: (a) det är
    // användarens första skanning(ar) — wow-faktor för nya användare, eller
    // (b) klienten uttryckligen ber om det ("försök igen, skarpare") OCH är Pro.
    const intro = await isIntroScan(user.id);
    const result = await identifyCard(image, {
      precise: intro || (precise && isPro(user)),
    });

    // Bokför mot kvoten: varje genomförd skanning räknas (träff eller no-match),
    // annars kan no-match-scans dränera API-budgeten gratis.
    await recordScanUsage(user.id);

    return jsonOk({ ...result, remaining: Math.max(0, quota.remaining - 1) });
  } catch (e) {
    return apiError(e);
  }
}
