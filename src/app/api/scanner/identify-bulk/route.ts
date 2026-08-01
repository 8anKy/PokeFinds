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
import { prisma } from "@/lib/db";
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
    .max(12),
  /**
   * ADMIN-FELSÖKNING: detekteringsbilden (~480 px JPEG) + antal funna
   * regioner. Bordsfångster går inte att felsöka mot syntetiska modeller —
   * ägarens andra fältrunda bevisade det (6 kort → 2 funna, syntetiken grön).
   * Lagras BARA för admin, i en FAILED-rad (räknas inte mot kvoten) som
   * telemetrin ignorerar (v:2). Läses av scripts/bulk-debug.ts.
   */
  debug: z
    .object({
      image: z.string().regex(/^data:image\/jpeg;base64,/).max(300_000),
      found: z.number().int().min(0).max(20),
      /** Kamerans FAKTISKA rutstorlek ("3840x2160"). Cellernas vision-bild och
       *  avtryck tas ur videorutan, inte ur felsökningsbilden — det är alltså
       *  här pixelbudgeten per kort avgörs, och utan den går det inte att skilja
       *  pixelsvält från andra fel. */
      video: z.string().max(20).optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    // En sida ≈ ett anrop; 20/min räcker för att bläddra en hel pärm och
    // binder samtidigt CPU:n (varje anrop är upp till ~100 indexsökningar).
    const { ok } = await rateLimit(`scanner-bulk:${user.id}`, 20, 60 * 1000);
    if (!ok) throw new ServiceError(429, "För många förfrågningar — vänta en stund.");
    const { cells, debug } = schema.parse(await req.json());

    const isAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";
    if (debug && isAdmin) {
      // status FAILED med flit: kvoten räknar icke-FAILED rader, och en
      // debugbild är ingen skanning. v:2 → telemetri/scoreboard hoppar över den.
      await prisma.scannerJob.create({
        data: {
          userId: user.id,
          imageUrl: "bulk-debug",
          status: "FAILED",
          result: { v: 2, bulk: true, found: debug.found, image: debug.image, video: debug.video },
        },
      });
    }
    if (cells.length === 0) return jsonOk({ cells: [] });
    return jsonOk({ cells: await identifyCellsArt(cells) });
  } catch (e) {
    return apiError(e);
  }
}
