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
  // Närbild på kortets NEDERKANT, där samlarnumret trycks. Valfri: kameravyn vet
  // var kortet sitter (kortramen) och kan skära ut den, en galleriuppladdning vet
  // det inte. Modellen läste annars HP:t uppe till höger som samlarnummer.
  detail: z
    .string()
    .regex(/^data:image\/[a-z+.-]+;base64,/i, "Närbilden måste vara en data-URL (image/*).")
    .optional(),
  // KONSTAVTRYCK, inset-svep: flera avtryck av SAMMA fångst beskurna olika, så
  // träffsäkerheten inte hänger på att kortet ligger exakt i ramen (mätt: ett
  // enda avtryck ger topp-15 9 % vid 6 % marginal, svepet 97 %). Varje avtryck är
  // 264 byte base64 ≈ 352 tecken — det är det som gör bildmatchningen billig:
  // klienten skickar ~1 kB UPP i stället för att ladda ner ett 5,4 MB-index.
  // Taket på 8 hindrar en klient från att beställa obegränsat med sökningar.
  fingerprints: z.array(z.string().min(1).max(1024)).max(8).optional(),
  // FLERA VIDEORUTOR, var och en ett inset-svep. Moiré och oskärpa varierar per
  // ruta, och avtrycket är gratis att räkna — så servern får välja den mest
  // avgörande rutan i stället för att döma på en enda. Taken (4 rutor × 8 avtryck)
  // binder serverns CPU: varje avtryck är en genomgång av indexet à ~8 ms.
  fingerprintFrames: z
    .array(z.array(z.string().min(1).max(1024)).max(8))
    .max(4)
    .optional(),
  // STRUKTURAVTRYCK (959 byte ≈ 1280 tecken base64), parade positionsvis med
  // färgavtrycken ovan. Belysningsimmuna särdrag som räddar SKÄRMFOTO-fallet
  // (topp-15 38,5 % → 97,1 %, se src/lib/art-fingerprint.ts). Valfria: äldre
  // cachade klienter skickar bara färg och får då exakt gamla beteendet.
  structFingerprints: z.array(z.string().min(1).max(2048)).max(8).optional(),
  structFrames: z
    .array(z.array(z.string().min(1).max(2048)).max(8))
    .max(4)
    .optional(),
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
      throw new ServiceError(429, "För många skanningar på kort tid. Vänta en stund.");
    }

    const {
      image,
      detail,
      fingerprints,
      fingerprintFrames,
      structFingerprints,
      structFrames,
      precise,
    } = schema.parse(await req.json());
    if (image.length + (detail?.length ?? 0) > MAX_IMAGE_BYTES * 1.4) {
      throw new ServiceError(413, "Bilden är för stor. Skala ner videorutan innan den skickas.");
    }

    // Månadskvot (binder vision-kostnaden mot Pro-priset). Admin = obegränsat.
    const quota = await getScannerQuota(user.id, effectivePlanTier(user), user.role);
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
      detailDataUrl: detail,
      fingerprints,
      fingerprintFrames,
      structFingerprints,
      structFrames,
    });

    // Bokför mot kvoten: varje genomförd skanning räknas (träff eller no-match),
    // annars kan no-match-scans dränera API-budgeten gratis.
    //
    // För ADMIN sparas dessutom vad modellen och bilden faktiskt svarade, så den
    // verkliga träffsäkerheten kan mätas. Allt vi har i dag är TAK-siffror: varje
    // mätning bygger på frågor härledda ur samma filer som referenserna, aldrig
    // på en riktig fångst. Avtrycket (264 byte) sparas, aldrig bilden.
    const isAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";
    await recordScanUsage(
      user.id,
      isAdmin
        ? {
            v: 1,
            provider: result.provider,
            guessedName: result.guessedName,
            guessedNumber: result.guessedNumber,
            guessedEra: result.guessedEra,
            guessedHp: result.guessedHp,
            confidence: result.confidence,
            artTop: result.artTop,
            artTopLabel: result.artTopLabel,
            chosen: result.candidates[0]
              ? {
                  cardId: result.candidates[0].cardId,
                  name: result.candidates[0].name,
                  number: result.candidates[0].number,
                  setName: result.candidates[0].setName,
                  score: result.candidates[0].score,
                }
              : null,
            // ALLA rutors svep, inte bara den första: servern dömer på den ruta
            // som var mest AVGÖRANDE (searchByFrames), så en replay med bara
            // ruta 1 återger inte det verkliga beslutet. ~16 × 352 tecken ≈
            // 5,6 kB per admin-rad — bara ägarens egna skanningar bär detta.
            frames: (
              fingerprintFrames ?? (fingerprints?.length ? [fingerprints] : [])
            )
              .slice(0, 4)
              // 6 = inset-svepet (4) + outset-svepet (2) — replayen ska kunna
              // återge även överflödesfallet (kort större än ramen).
              .map((f) => f.slice(0, 6)),
            structFrames: (
              structFrames ?? (structFingerprints?.length ? [structFingerprints] : [])
            )
              .slice(0, 4)
              .map((f) => f.slice(0, 6)),
          }
        : undefined
    );

    return jsonOk({ ...result, remaining: Math.max(0, quota.remaining - 1) });
  } catch (e) {
    return apiError(e);
  }
}
