import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().min(1).max(400).optional(),
  platform: z.string().max(20).default("ios"),
  error: z.string().max(2000).optional(),
});

/** Registrerar (eller flyttar) en enhets push-token, eller loggar ett registreringsfel. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { token, platform, error } = schema.parse(await req.json());
    if (error) {
      console.error(`[push] registrationError user=${user.id}: ${error}`);
      // Egen kolumn → clobbras inte av inställnings-PATCH:en (till skillnad från
      // ett fält i notificationSettings-JSON:en).
      await prisma.user.update({
        where: { id: user.id },
        data: { lastPushError: `${new Date().toISOString()} ${error}`.slice(0, 1900) },
      });
      return jsonOk({ ok: true });
    }
    if (!token) return jsonOk({ ok: true });
    await prisma.pushToken.upsert({
      where: { token },
      create: { token, platform, userId: user.id },
      update: { userId: user.id, platform },
    });
    return jsonOk({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
