/**
 * POST /api/admin/feed-inbox/cover — ägarens eget omslag till ett utkast.
 *
 * multipart/form-data: `file` (jpeg/png/webp, ≤ 2 MB efter klientens nedskalning),
 * `draftId`. Filen läggs på volymen och svaret är vägen som ska in i `imageUrl`.
 *
 * ⛔ Volymen, inte bucketen: bucketens läs-URL:er är signerade och dör efter sju
 *    dygn — en nyhet ligger kvar längre än så. Se `feed-inbox-store.ts`.
 * ⛔ Magic bytes avgör typen, aldrig filens egen `type`.
 */
import { randomBytes } from "node:crypto";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { coverExtension, coverUrl, writeCover } from "@/lib/feed-inbox-store";
import { MAX_IMAGE_BYTES, sniffImageType } from "@/lib/object-storage";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await requireRole("ADMIN");
    const form = await req.formData();
    const file = form.get("file");
    const draftId = String(form.get("draftId") ?? "");
    if (!(file instanceof Blob)) return jsonOk({ error: "Ingen fil." }, { status: 400 });
    if (!/^[a-z0-9]{1,32}$/.test(draftId)) return jsonOk({ error: "Ogiltigt utkast-id." }, { status: 400 });
    if (file.size > MAX_IMAGE_BYTES) return jsonOk({ error: "Bilden är för stor (max 2 MB)." }, { status: 413 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffImageType(bytes);
    const ext = type ? coverExtension(type) : null;
    if (!ext) return jsonOk({ error: "Bara JPEG, PNG eller WebP." }, { status: 415 });

    const name = `${draftId}-${randomBytes(4).toString("hex")}.${ext}`;
    await writeCover(name, bytes);
    return jsonOk({ ok: true, imageUrl: coverUrl(name) });
  } catch (e) {
    return apiError(e);
  }
}
