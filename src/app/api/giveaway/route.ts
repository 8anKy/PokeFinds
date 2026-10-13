/**
 * Giveaway. GET = perioden + (inloggad) mina lotter. POST = anmäl mig / ändra
 * mina användarnamn. Regler och lottmodell: src/lib/giveaway.ts.
 */
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { auth, requireUser } from "@/lib/auth";
import { getGiveawayStatus, joinGiveaway } from "@/services/giveaway";

export const dynamic = "force-dynamic";

const joinSchema = z.object({
  tiktokHandle: z.string().max(120),
  instagramHandle: z.string().max(120),
  // Reglerna + åldern (13+, under 18 med målsmans godkännande) måste kryssas i.
  accept: z.literal(true),
});

export async function GET() {
  try {
    const session = await auth();
    return jsonOk(await getGiveawayStatus(session?.user?.id ?? null));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const input = joinSchema.parse(await req.json());
    await joinGiveaway(user.id, input);
    return jsonOk(await getGiveawayStatus(user.id));
  } catch (e) {
    return apiError(e);
  }
}
