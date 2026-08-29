/**
 * POST /api/scanner/feedback — användarens EGNA val blir facit.
 *
 * När användaren KORRIGERAR en skanning (väljer ett annat kort i kandidat-
 * listan) har hen just tittat på det fysiska kortet och pekat ut rätt rad —
 * det är facit av samma kvalitet som en manuell etikett, och det försvann
 * förut i klienten. När hen lägger den föreslagna träffen i samlingen utan
 * ändring är det en BEKRÄFTELSE (svagare: kan vara ouppmärksamhet).
 *
 * Skrivs in i ScannerJob.result som `userChosen` och läses av
 * scripts/scanner-scoreboard.ts: korrigering = starkt facit, bekräftelse =
 * svagt. En SVAGARE dom får aldrig skriva över en starkare (användaren
 * korrigerar först och trycker "Lägg till alla" sen — kind ska förbli
 * "corrected"). Ordningen bor i `src/lib/scan-verdict.ts`.
 *
 * ⛔ **ÖPPEN FÖR ALLA SEDAN 2026-08-15** (var admin-only). Skälet till grinden
 * var att vanliga rader saknade något att koppla facit till; sedan
 * `recall`-blocket skrivs för alla (se recordScanUsage) gäller det inte längre.
 * Och grinden var själva problemet: den mätte bara ÄGARENS omsorgsfulla
 * fångster. Samma snedvridning fick oss att tro att 79 % av skanningarna var
 * gratis när produktionen låg på 30,5 %.
 *
 * ⛔ Vi lagrar ett KORT-ID användaren själv pekat ut — ingen bild, inget
 * avtryck, inget om personen utöver att kontot skannade ett kort. Avtrycket
 * (264 byte, för fält-referenser) är ett STÖRRE steg som kräver en rad i
 * integritetspolicyn; den här raden gör det inte.
 */
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
// Ordningen bor i en ren modul — den avgör vad som hamnar i facit och är testad
// separat (tests/unit/scan-verdict.test.ts). Se filhuvudet där för varför.
import { verdictStrength } from "@/lib/scan-verdict";

export const dynamic = "force-dynamic";

/**
 * ⛔ **"BEKRÄFTAD" BETYDDE INTE "GRANSKAD" — 82 % AV FACIT VAR ETT KNAPPTRYCK.**
 *
 * Mätt 2026-08-29: 533 av 649 domar kom i skurar om ≥5 med ≤5 s mellanrum
 * (median-glapp 161 ms mellan två domar hos samma användare) — signaturen av
 * `addAll()`, som skickar EN bekräftelse per kort i hela brickan efter ETT tryck.
 * Över alla strata är det 83,4 % av allt facit.
 * ⛔ Det AVGÖRANDE är inte att recallen skiljer sig — inom vision-stratumet är
 * gapet bara 6,6 p.e. på topp-1 (aktivt val 46,0 % n=50 mot masstryck 39,4 %
 * n=454). Det avgörande är att ett masstryck ALDRIG kan bli en korrigering:
 * 0 av 454 mot 2 av 50. Hinken kan bara säga ja.
 * Utan `via` mäter hinken alltså "användaren invände inte" i stället för
 * "användaren granskade" — och de två går inte att skilja i efterhand, hur bra
 * analysen än är.
 *
 * `kind` breddas samtidigt med de två NEGATIVA domarna som förut kastades tyst:
 * en raderad skanning och ett hopp till manuell sökning är båda facit om att vi
 * hade fel, och de är anrikade med precis de SVÅRA fall bekräftelserna saknar.
 */
const schema = z
  .object({
  jobId: z.string().min(10).max(64),
  /**
   * ⛔ VALFRITT, OCH DET ÄR HELA POÄNGEN MED DE NEGATIVA DOMARNA. En raderad
   * skanning som aldrig fick en träff har inget kort att peka på — kräver man
   * ett `cardId` går exakt det svåraste facit:et förlorat, vilket är den bias
   * som redan gör alla recall-tal till ett TAK. `superRefine` nedan kräver det
   * bara där det faktiskt bär mening.
   */
  cardId: z.string().min(10).max(64).optional(),
  kind: z.enum([
    /** Användaren valde ett ANNAT KORT ur listan — starkast facit vi kan få. */
    "corrected",
    /** Användaren tog vårt förslag. Styrkan avgörs av `via`, inte av kind. */
    "confirmed",
    /** Användaren RADERADE skanningen — vi hade fel, eller fångsten var oduglig. */
    "rejected",
    /** Användaren gick till manuell sökning — vårt svar dög inte. */
    "searched",
  ]),
  /**
   * HUR domen uppstod. ⛔ Utelämnad på alla rader före 2026-08-29; rapporten
   * gissar då på skurdetektion, vilket är sämre men inte värdelöst.
   */
  via: z.enum(["pick", "bulk", "auto"]).optional(),
  /**
   * TRYCKNINGEN användaren stannade på. Ett variantbyte (samma `cardId`, annan
   * `productId`) är en ÄKTA rättelse av produkten — den avgör pris, länk och
   * samlingsvärde — men INTE av kortet, och recall mäter kort. Därför förblir
   * `kind` "confirmed" och bytet räknas via `variantChanged`.
   * ⛔ Slås de ihop blir korrigeringshinken kontaminerad med rader som har
   * samma artRank som en bekräftelse per konstruktion — en tredje upplaga av
   * exakt den fälla `src: "bulk"` och `src: "art"` redan dokumenterar.
   */
  productId: z.string().min(10).max(64).optional(),
  variantChanged: z.boolean().optional(),
  /** 1-baserad plats i den VISADE listan användaren tog. 0/utelämnad = inte därifrån. */
  rank: z.number().int().min(0).max(64).optional(),
  })
  .superRefine((v, ctx) => {
    // En POSITIV dom pekar per definition ut ett kort; en negativ behöver inte.
    if ((v.kind === "corrected" || v.kind === "confirmed") && !v.cardId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cardId"],
        message: "cardId krävs för corrected/confirmed.",
      });
    }
  });

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    // Endpointen skriver, och är öppen för alla sedan admin-grinden togs bort.
    // Taket är generöst med flit: en pärmfångst sparar upp till 15 kort i ett
    // svep, och ett tappat facit är värre än ett extra anrop.
    const { ok } = await rateLimit(`scanner-feedback:${user.id}`, 120, 60 * 1000);
    if (!ok) throw new ServiceError(429, "För många rapporter på kort tid.");
    const { jobId, cardId, kind, via, productId, variantChanged, rank } = schema.parse(
      await req.json()
    );

    const job = await prisma.scannerJob.findUnique({
      where: { id: jobId },
      select: { userId: true, result: true },
    });
    if (!job || job.userId !== user.id) {
      throw new ServiceError(404, "Skanningen hittades inte.");
    }
    // Facit måste peka på ett riktigt kort — skräp-id ska inte bli etikett.
    // (Negativa domar får sakna kort helt, se schemat.)
    if (cardId) {
      const card = await prisma.card.findUnique({ where: { id: cardId }, select: { id: true } });
      if (!card) throw new ServiceError(400, "Okänt kort.");
    }

    const existing =
      job.result && typeof job.result === "object" && !Array.isArray(job.result)
        ? (job.result as Record<string, unknown>)
        : {};
    const prev = existing.userChosen as { kind?: string; via?: string } | undefined;
    // En SVAGARE dom får aldrig skriva över en starkare. Lika stark skriver om
    // (idempotent: samma handling två gånger ska ge samma rad, och StrictMode
    // dubbelkör updatern i dev).
    if (prev && verdictStrength(kind, via) < verdictStrength(prev.kind, prev.via)) {
      return jsonOk({ recorded: false });
    }
    await prisma.scannerJob.update({
      where: { id: jobId },
      data: {
        result: {
          ...existing,
          userChosen: {
            // Null skrivs UT för en negativ dom utan kort: nyckeln ska finnas så
            // rapporten kan skilja "ingen träff att avvisa" från en äldre rad.
            cardId: cardId ?? null,
            kind,
            // Utelämnas när de saknas — en `null` i JSON hade sagt "vi vet att
            // det inte fanns", och det är inte samma sak som en äldre klient.
            ...(via ? { via } : {}),
            ...(productId ? { productId } : {}),
            ...(variantChanged ? { variantChanged: true } : {}),
            ...(rank != null ? { rank } : {}),
            at: new Date().toISOString(),
          },
        },
      },
    });
    return jsonOk({ recorded: true });
  } catch (e) {
    return apiError(e);
  }
}
