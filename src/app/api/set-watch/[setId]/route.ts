import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { removeSetWatch, setSetWatchPaused } from "@/services/set-watch";

export const dynamic = "force-dynamic";

const patchSchema = z.object({ isPaused: z.boolean() });

/** Pausa/återuppta en set-bevakning (bevakningssidans Set-flik, 2026-10-25). */
export async function PATCH(req: Request, { params }: { params: { setId: string } }) {
  try {
    const user = await requireUser();
    const { isPaused } = patchSchema.parse(await req.json());
    return jsonOk(await setSetWatchPaused(user.id, params.setId, isPaused));
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { setId: string } }
) {
  try {
    const user = await requireUser();
    const result = await removeSetWatch(user.id, params.setId);
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}
