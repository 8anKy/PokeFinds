import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/errors";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import {
  ALLOWED_IMAGE_TYPES,
  buildImageKey,
  MAX_IMAGE_BYTES,
  putImage,
  sniffImageType,
  storageEnabled,
} from "@/lib/object-storage";

export const dynamic = "force-dynamic";

/**
 * Kapacitetskoll för klienten: är bilduppladdning påslagen alls? Bildväljaren
 * renderar ingenting när svaret är nej — forumet fungerar utan bilder.
 */
export async function GET() {
  return jsonOk({ enabled: storageEnabled() });
}

function parseDim(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value === "") return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 && n <= 20_000 ? n : null;
}

/**
 * Tar emot EN bild (multipart `file`, valfritt `width`/`height`), verifierar
 * typen på magic bytes och lägger den i bucketen under användarens prefix.
 * Svarar med nyckeln — tråden binder nyckeln till sig vid publiceringen.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    if (!storageEnabled()) {
      throw new ServiceError(503, "Bilduppladdning är inte tillgänglig just nu.");
    }

    const { ok } = await rateLimit(`community-upload:${user.id}`, 30, 60 * 60 * 1000);
    if (!ok) {
      throw new ServiceError(429, "Du har laddat upp för många bilder. Försök igen om en stund.");
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) throw new ServiceError(400, "Ingen bild skickades.");
    if (file.size > MAX_IMAGE_BYTES) {
      throw new ServiceError(413, "Bilden är för stor (max 2 MB efter nedskalning).");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffImageType(bytes);
    if (!type || !ALLOWED_IMAGE_TYPES.has(type)) {
      throw new ServiceError(415, "Bara JPEG, PNG och WebP kan laddas upp.");
    }
    // MIME-typen klienten påstår får inte motsäga innehållet — en omdöpt fil
    // ska falla här, inte i webbläsaren hos den som tittar.
    if (file.type && file.type !== type) {
      throw new ServiceError(415, "Bildens filtyp stämmer inte med innehållet.");
    }

    const key = buildImageKey(user.id, type);
    if (!key) throw new ServiceError(400, "Kunde inte skapa en bildnyckel.");
    await putImage(key, bytes, type);

    return jsonOk(
      { key, width: parseDim(form.get("width")), height: parseDim(form.get("height")) },
      { status: 201 }
    );
  } catch (e) {
    return apiError(e);
  }
}
