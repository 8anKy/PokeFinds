/**
 * Tidigare importer + ångra.
 *
 * ⛔ DELETE tar bort SAMLINGSPOSTERNA, inte importraden — den behålls märkt
 * `undoneAt` så att samma fil kan importeras om utan dubblettvarning och så att
 * "vart tog mina kort vägen?" har ett svar.
 */
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { listImports, undoImport } from "@/services/collection-import";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    return jsonOk({ imports: await listImports(user.id) });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const id = new URL(req.url).searchParams.get("id") ?? "";
    return jsonOk(await undoImport(user.id, id));
  } catch (e) {
    return apiError(e);
  }
}
