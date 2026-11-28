/**
 * POST /api/scanner/identify-art — LIVE bildmatchning medan användaren siktar.
 *
 * Ingen vision-modell, ingen bilduppladdning, ingen ScannerJob-rad: klienten
 * skickar ~10 kB avtryck per poll och får topplistan tillbaka på ~20 ms.
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
import { resolveScanActorKey } from "@/lib/scan-actor";
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
    // Gäst (enhets-id) eller inloggad — live-pollen kostar ingen kvot, bara CPU. Ingen
    // databasläsning per poll: nyckeln räcker (se resolveScanActorKey).
    const key = await resolveScanActorKey(req);
    // Upp till ~8 poll/s i kameravyn (AUTO_TICK_MS 120, en poll i taget) = 500/min; taket binder
    // CPU:n (~20 ms per poll sedan SIMD-kärnan, art-index.ts).
    const { ok } = await rateLimit(`scanner-art:${key}`, 600, 60 * 1000);
    if (!ok) throw new ServiceError(429, "För många förfrågningar.");
    const { fingerprints, structFingerprints } = schema.parse(await req.json());
    return jsonOk(await identifyCardArt({ fingerprints, structFingerprints }));
  } catch (e) {
    return apiError(e);
  }
}
