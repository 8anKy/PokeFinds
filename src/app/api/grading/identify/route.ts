/**
 * POST /api/grading/identify — "Är det här ditt kort?" (2026-10-01).
 *
 * Skannerns bildmatchning på graderingens framsida: klienten räknar konstavtrycken
 * (`lib/photo-fingerprints.ts`) och skickar ~2 kB, servern söker indexet i minnet.
 * Ingen AI, ingen kvot, ingen ScannerJob-rad — samma villkor som skannerns
 * live-poll (`/api/scanner/identify-art`). Graderingen själv görs fortfarande av
 * AI:n; det här avgör bara VILKET kort det är.
 *
 * MÄTT 2026-10-01 (80 slumpade katalogkort, syntetiska foton): upprätat utsnitt
 * (centreringsmätaren) topp-1 96 %, topp-3 100 %; foto på mörkt underlag 86 % /
 * 96–100 %; ljust underlag sämre (kvad-detekteringen tappar ~30 %). "confident"
 * hade NOLL fel i alla profiler — därför förväljs bara de träffarna.
 */
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { ART_TRUST_SCORE, identifyCardArt } from "@/services/scanner";

export const dynamic = "force-dynamic";

const schema = z.object({
  fingerprints: z.array(z.string().min(1).max(1024)).min(1).max(8),
  structFingerprints: z.array(z.string().min(1).max(2048)).max(8).optional(),
});

/**
 * FÖRSLAGSGOLVET (2026-10-04, ägarens fältrapport: Pikachu i toploader gav tre
 * Charmander/Mew-förslag). Rätta bildträffar mäter 0,56–0,95 (scanner/index.ts,
 * ART_TRUST_SCORE); under golvet är en träff praktiskt taget alltid fel, och tre fel
 * kort under "Vilket kort är det?" är värre än "hittade inte kortet — sök".
 */
const SUGGEST_MIN_SCORE = ART_TRUST_SCORE;

export interface GradingIdentifyCandidate {
  cardId: string;
  name: string;
  number: string;
  setName: string;
  imageUrl: string | null;
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { ok } = await rateLimit(`grading-identify:${user.id}`, 30, 60 * 1000);
    if (!ok) throw new ServiceError(429, "För många förfrågningar.");
    const art = await identifyCardArt(schema.parse(await req.json()));
    const ids = art.candidates
      .filter((c) => c.score >= SUGGEST_MIN_SCORE)
      .slice(0, 5)
      .map((c) => c.cardId);
    const rows = ids.length
      ? await prisma.card.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, number: true, imageUrl: true, set: { select: { name: true } } },
        })
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const candidates: GradingIdentifyCandidate[] = ids.flatMap((id) => {
      const r = byId.get(id);
      return r ? [{ cardId: r.id, name: r.name, number: r.number, setName: r.set.name, imageUrl: r.imageUrl }] : [];
    });
    return jsonOk({ candidates, confident: art.confident });
  } catch (e) {
    return apiError(e);
  }
}
