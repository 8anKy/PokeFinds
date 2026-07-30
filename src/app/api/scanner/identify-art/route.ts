/**
 * POST /api/scanner/identify-art — LIVE bildmatchning medan användaren siktar.
 *
 * Ingen vision-modell, ingen bilduppladdning, ingen ScannerJob-rad: klienten
 * skickar ~1 kB konstavtryck per poll och får topplistan tillbaka på ~40 ms.
 * Det är det som ger "låset" i kameravyn innan slutaren ens trycks — samma
 * känsla som konkurrenternas scanners, utan deras tjänsteabonnemang.
 *
 * KVOTEN RÖRS INTE: den finns för att binda vision-KOSTNADEN mot intäkten, och
 * pollen kostar ingen AI alls. Själva skanningen (slutartrycket → /identify)
 * bokförs mot kvoten precis som förut, även när vision hoppas över — en
 * "skanning" förblir samma produktbegrepp oavsett hur den avgjordes.
 * Rate-limiten skyddar CPU:n (varje poll är en indexgenomgång i minnet).
 */
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { identifyCardArt } from "@/services/scanner";

export const dynamic = "force-dynamic";

const schema = z.object({
  fingerprints: z.array(z.string().min(1).max(1024)).min(1).max(8),
  structFingerprints: z.array(z.string().min(1).max(2048)).max(8).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    // ~2 poll/s i kameravyn → 120/min räcker med marginal; taket binder CPU.
    const { ok } = await rateLimit(`scanner-art:${user.id}`, 180, 60 * 1000);
    if (!ok) throw new ServiceError(429, "För många förfrågningar.");
    const { fingerprints, structFingerprints } = schema.parse(await req.json());
    return jsonOk(await identifyCardArt({ fingerprints, structFingerprints }));
  } catch (e) {
    return apiError(e);
  }
}
