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
 * svagt. En bekräftelse får ALDRIG skriva över en korrigering (användaren
 * korrigerar först och lägger till sen — kind ska förbli "corrected").
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

export const dynamic = "force-dynamic";

const schema = z.object({
  jobId: z.string().min(10).max(64),
  cardId: z.string().min(10).max(64),
  kind: z.enum(["corrected", "confirmed"]),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    // Endpointen skriver, och är öppen för alla sedan admin-grinden togs bort.
    // Taket är generöst med flit: en pärmfångst sparar upp till 15 kort i ett
    // svep, och ett tappat facit är värre än ett extra anrop.
    const { ok } = await rateLimit(`scanner-feedback:${user.id}`, 120, 60 * 1000);
    if (!ok) throw new ServiceError(429, "För många rapporter på kort tid.");
    const { jobId, cardId, kind } = schema.parse(await req.json());

    const job = await prisma.scannerJob.findUnique({
      where: { id: jobId },
      select: { userId: true, result: true },
    });
    if (!job || job.userId !== user.id) {
      throw new ServiceError(404, "Skanningen hittades inte.");
    }
    // Facit måste peka på ett riktigt kort — skräp-id ska inte bli etikett.
    const card = await prisma.card.findUnique({ where: { id: cardId }, select: { id: true } });
    if (!card) throw new ServiceError(400, "Okänt kort.");

    const existing =
      job.result && typeof job.result === "object" && !Array.isArray(job.result)
        ? (job.result as Record<string, unknown>)
        : {};
    const prev = existing.userChosen as { kind?: string } | undefined;
    // En bekräftelse får aldrig degradera en korrigering.
    if (kind === "confirmed" && prev?.kind === "corrected") {
      return jsonOk({ recorded: false });
    }
    await prisma.scannerJob.update({
      where: { id: jobId },
      data: {
        result: {
          ...existing,
          userChosen: { cardId, kind, at: new Date().toISOString() },
        },
      },
    });
    return jsonOk({ recorded: true });
  } catch (e) {
    return apiError(e);
  }
}
