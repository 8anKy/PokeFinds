/**
 * POST /api/scanner/identify-bulk — EN bild, MÅNGA kort (pärmsida/bordsyta).
 *
 * Klienten delar upp fångsten i celler (rutnätsoverlayen är en
 * placeringsguide) och skickar varje cells avtryckssvep. Ren bildmatchning:
 * ingen vision, ingen bilduppladdning, INGEN KVOT — kvoten binder
 * vision-kostnad, och den här vägen kostar ~1 s CPU mot indexet i minnet.
 * Celler där trust-regeln inte håller körs vidare av klienten mot /identify
 * (en i taget, med cellens bildutsnitt) och bokförs där som vanligt.
 *
 * Taken (12 celler × 8 avtryck) binder CPU per anrop; rate-limiten binder den
 * per användare. ~1 kB per cell upp, kort-id + priser ner — samma egressform
 * som enkelskanningen.
 */
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { identifyCellsArt } from "@/services/scanner";

export const dynamic = "force-dynamic";

const schema = z.object({
  cells: z
    .array(
      z.object({
        fingerprints: z.array(z.string().min(1).max(1024)).min(1).max(8),
        structFingerprints: z.array(z.string().min(1).max(2048)).max(8).optional(),
      })
    )
    .min(1)
    .max(12),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    // En sida ≈ ett anrop; 20/min räcker för att bläddra en hel pärm och
    // binder samtidigt CPU:n (varje anrop är upp till ~100 indexsökningar).
    const { ok } = await rateLimit(`scanner-bulk:${user.id}`, 20, 60 * 1000);
    if (!ok) throw new ServiceError(429, "För många förfrågningar — vänta en stund.");
    const { cells } = schema.parse(await req.json());
    return jsonOk({ cells: await identifyCellsArt(cells) });
  } catch (e) {
    return apiError(e);
  }
}
