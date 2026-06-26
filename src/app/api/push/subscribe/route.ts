import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().min(1).max(400),
  platform: z.string().max(20).default("ios"),
});

/** Registrerar (eller flyttar) en enhets push-token till inloggad användare. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { token, platform } = schema.parse(await req.json());
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
