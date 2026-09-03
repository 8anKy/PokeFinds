import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { block, listBlocked, unblock } from "@/services/blocks";

export const dynamic = "force-dynamic";

const schema = z.object({ userId: z.string().min(1).max(64) });

/** Dem jag blockerat. */
export async function GET() {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const blocked = await listBlocked(user.id);
    return jsonOk({ blocked }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return apiError(e);
  }
}

/** Blockera (idempotent). */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const input = schema.parse(await req.json());
    await block(user.id, input.userId);
    return jsonOk({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

/** Avblockera (idempotent). */
export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const input = schema.parse(await req.json());
    await unblock(user.id, input.userId);
    return jsonOk({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
