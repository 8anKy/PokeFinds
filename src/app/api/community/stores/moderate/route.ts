import { z } from "zod";
import { revalidateTag } from "next/cache";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { prisma } from "@/lib/db";
import { COMMUNITY_STORES_TAG } from "@/lib/community-stores";
import { revalidateForum } from "../../_shared/revalidate";

export async function GET() {
  try {
    const user = await requireRole("ADMIN");
    await assertCommunityV2(user.role);
    return jsonOk({ items: await prisma.communityStore.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 100, select: { id: true, name: true, address: true, city: true, latitude: true, longitude: true } }) });
  } catch (e) { return apiError(e); }
}
export async function PATCH(req: Request) {
  try {
    const user = await requireRole("ADMIN");
    await assertCommunityV2(user.role);
    const input = z.object({ id: z.string().min(1).max(64), status: z.enum(["APPROVED", "REJECTED"]) }).parse(await req.json());
    await prisma.communityStore.update({ where: { id: input.id, status: "PENDING" }, data: { status: input.status } });
    revalidateTag(COMMUNITY_STORES_TAG);
    revalidateForum();
    return jsonOk({ ok: true });
  } catch (e) { return apiError(e); }
}
