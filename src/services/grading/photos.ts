/**
 * GRADERINGSFOTONA SPARAS (ägarbeslut 2026-10-04) — i den privata bucketen, så att
 * en tidigare gradering kan öppnas med användarens egna foton, skadornas rutor och
 * "Mitt foto" på slabben. Förut sparades de aldrig och historiken hade bara listan.
 *
 * ⛔ BÄSTA FÖRSÖK: en bucket som inte svarar får aldrig fälla graderingen — då sparas
 *    helt enkelt inga foton och historiken visar listan som förut.
 * ⛔ Inte AI-träning: fotona visas bara för ägaren och raderas med kontot
 *    (`deleteUserImages`). Policyn säger exakt det (Privacy.s2Items).
 * Kostnad: ~0,5–2 MB per gradering à $0,015/GB-månad — försumbart (object-storage.ts).
 */
import {
  buildGradingPhotoKey,
  extensionFor,
  putImage,
  sniffImageType,
  storageEnabled,
} from "@/lib/object-storage";
import { parseGradingImage } from "@/services/grading/contract";

export interface GradingPhotoKeys {
  front: string | null;
  back: string | null;
}

async function storeOne(userId: string, jobId: string, side: "front" | "back", dataUrl: string): Promise<string | null> {
  const { data } = parseGradingImage(dataUrl);
  const bytes = new Uint8Array(Buffer.from(data, "base64"));
  // Typen tas ur BYTESEN, aldrig ur data-URL:ens påstående.
  const type = sniffImageType(bytes);
  const ext = type ? extensionFor(type) : null;
  if (!type || !ext) return null;
  const key = buildGradingPhotoKey(userId, jobId, side, ext);
  if (!key) return null;
  await putImage(key, bytes, type);
  return key;
}

export async function storeGradingPhotos(
  userId: string,
  jobId: string,
  front: string,
  back: string
): Promise<GradingPhotoKeys | null> {
  if (!storageEnabled()) return null;
  const [f, b] = await Promise.all([
    storeOne(userId, jobId, "front", front).catch(() => null),
    storeOne(userId, jobId, "back", back).catch(() => null),
  ]);
  if (!f && !b) {
    console.warn("[grading/photos] kunde inte spara fotona (bucketen svarade inte)");
    return null;
  }
  return { front: f, back: b };
}
