import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/errors";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import {
  ALLOWED_IMAGE_TYPES,
  buildImageKey,
  buildThumbKey,
  MAX_IMAGE_BYTES,
  MAX_THUMB_BYTES,
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
 * Tar emot EN bild (multipart `file`, valfritt `width`/`height` samt `thumb`),
 * verifierar typen på magic bytes och lägger den i bucketen under användarens
 * prefix. Svarar med nyckeln — tråden binder nyckeln till sig vid publiceringen.
 *
 * `thumb` är samma bild i ≤320 px, gjord av KLIENTEN (canvas): trådlistan visar
 * 80×80 och originalet är ~300 kB, så utan miniatyr laddar ett flöde på tjugo
 * kort ~6 MB. ⛔ Servern skalar inte om — Railway-processen har ett minnestak
 * på ~550 MB med självomstart, och en bildpipeline där är precis det taket
 * inte tål. Uteblir miniatyren är det inget fel: tråden faller tillbaka på
 * originalet (PostImage.thumbKey null).
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

    // Miniatyren är best effort: originalet ligger redan uppe och en tråd utan
    // miniatyr är fullt läsbar. Aldrig ett kastat fel här.
    let thumbKey: string | null = null;
    const thumb = form.get("thumb");
    if (thumb instanceof Blob && thumb.size > 0 && thumb.size <= MAX_THUMB_BYTES) {
      try {
        const thumbBytes = new Uint8Array(await thumb.arrayBuffer());
        const thumbType = sniffImageType(thumbBytes);
        const derived = thumbType && ALLOWED_IMAGE_TYPES.has(thumbType) ? buildThumbKey(key) : null;
        if (derived && thumbType) {
          await putImage(derived, thumbBytes, thumbType);
          thumbKey = derived;
        }
      } catch (err) {
        console.error(
          "[community] miniatyren kunde inte sparas:",
          err instanceof Error ? err.message : err
        );
      }
    }

    return jsonOk(
      {
        key,
        thumbKey,
        width: parseDim(form.get("width")),
        height: parseDim(form.get("height")),
      },
      { status: 201 }
    );
  } catch (e) {
    return apiError(e);
  }
}
