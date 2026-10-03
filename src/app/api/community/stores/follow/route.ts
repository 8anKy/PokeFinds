import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { prisma } from "@/lib/db";
import { reportableStore } from "@/services/community-stores";
import { rateLimit } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/errors";

export async function GET() {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const rows = await prisma.communityStoreFollow.findMany({ where: { userId: user.id }, select: { storeId: true } });
    return jsonOk({ ids: rows.map(r => r.storeId) });
  } catch (e) { return apiError(e); }
}
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const { ok } = await rateLimit(`community-store-follow:${user.id}`, 60, 60000);
    if (!ok) throw new ServiceError(429, "För många förfrågningar. Försök igen om en stund.");
    const { storeId, following } = z.object({ storeId: z.string().min(1).max(64), following: z.boolean() }).parse(await req.json());
    await reportableStore(storeId);
    if (following) await prisma.communityStoreFollow.upsert({ where: { userId_storeId: { userId: user.id, storeId } }, create: { userId: user.id, storeId }, update: {} });
    else await prisma.communityStoreFollow.deleteMany({ where: { userId: user.id, storeId } });
    return jsonOk({ following });
  } catch (e) { return apiError(e); }
}
