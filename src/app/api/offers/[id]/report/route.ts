import { z } from "zod";
import { OfferReportReason } from "@prisma/client";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { auth } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const schema = z.object({
  reason: z.nativeEnum(OfferReportReason),
  note: z.string().trim().max(500).optional(),
});

/**
 * Användaranmälan av ett felaktigt butikserbjudande.
 *
 * MEDVETET TILLÅTET UTLOGGAD. En felaktig butikslänk är osynlig för våra vakter —
 * den upptäcks bara av personen som klickade och landade på fel vara. Kräver vi
 * inloggning för att rapportera tappar vi merparten av signalen. Vi vill hellre ha
 * rapporten än kontot.
 *
 * Rättningen sker sedan mot RÅDATA (radera/omdirigera Offer via ID i /admin) —
 * aldrig genom att lappa det visade aggregatet.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = schema.parse(await req.json());

    const offer = await prisma.offer.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!offer) throw new ServiceError(404, "Erbjudandet hittades inte.");

    const session = await auth();
    const reporterId = session?.user?.id ?? null;

    // Spam-broms: samma anmälare (eller samma anonyma offer) får inte fylla kön med
    // dubbletter av samma anmälan. En öppen anmälan per (offer, anmälare) räcker —
    // signalen är "den här länken är fel", inte hur många gånger den rapporterats.
    const existing = await prisma.offerReport.findFirst({
      where: { offerId: offer.id, reporterId, status: "OPEN" },
      select: { id: true },
    });
    if (existing) return jsonOk({ reported: true, deduped: true });

    await prisma.offerReport.create({
      data: {
        offerId: offer.id,
        reporterId,
        reason: body.reason,
        note: body.note || null,
      },
    });

    return jsonOk({ reported: true });
  } catch (e) {
    return apiError(e);
  }
}
