import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser, requireEntitledUser } from "@/lib/auth";
import { isPro } from "@/lib/plan";
import { addSetWatch, listSetWatches, listSetWatchIds } from "@/services/set-watch";

export const dynamic = "force-dynamic";

const addSchema = z.object({ setId: z.string().min(1) });

/**
 * `?ids=1` → bara setId:na. Produktkortets klocka behöver veta om DET här setet
 * bevakas och inget mer; att skicka namn, serie och sealed-antal för varje bevakat
 * set till varje rutnätsvy vore ren egress för data som aldrig ritas.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (new URL(req.url).searchParams.get("ids") === "1") {
      return jsonOk({ setIds: await listSetWatchIds(user.id) });
    }
    return jsonOk({ items: await listSetWatches(user.id) });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    // Pro-grindad → färsk plan ur DB, aldrig sessionstoken (som släpar 30 min
    // efter ett köp). GET ovan är ogrindad och läser token:en gratis.
    const user = await requireEntitledUser();
    const { setId } = addSchema.parse(await req.json());
    const result = await addSetWatch(user.id, isPro(user), setId);
    return jsonOk(result, { status: result.created ? 201 : 200 });
  } catch (e) {
    return apiError(e);
  }
}
