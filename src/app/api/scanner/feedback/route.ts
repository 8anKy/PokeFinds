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
 * Bara admin, samma grind som diagnostiken (dataminimering): vanliga
 * användares rader saknar diagnostik och har inget att koppla facit till.
 */
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
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
    if (user.role !== "ADMIN" && user.role !== "SUPERADMIN") {
      // Tyst ok: klienten skickar bara när den fått ett jobId, men grinden
      // står här också (försvar i djupet, inte klientens ansvar).
      return jsonOk({ recorded: false });
    }
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
