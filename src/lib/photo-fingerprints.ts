/**
 * KONSTAVTRYCK UR ETT STILLBILDSFOTO (2026-10-01) — graderingens "Är det här ditt
 * kort?". Samma avtryck som skannerns kamerafångst (`lib/art-fingerprint.ts`), men
 * källan är ett uppladdat foto i stället för en videoruta med siktram:
 *
 *  1. KVAD-RÄTNING först — ett graderingsfoto har bord runt kortet och tas ofta
 *     lite snett, så kortets fyra hörn letas upp och bilden rätas till 63:88,
 *     samma geometri som katalogbilderna (`lib/card-quad.ts`).
 *  2. Hela bilden med inset-svepet — för fotot som redan ÄR kortet (centrerings-
 *     mätarens upprätade utsnitt, eller ett tajt beskuret foto).
 *
 * Servern tar bästa varianten per kort, så ett avtryck som missar kan aldrig göra
 * svaret sämre — samma princip som skannerns svep. ≤ 8 avtryck (API-taket).
 *
 * Kärnan är ren (RGB(A)-pixlar in, base64 ut) och körs identiskt i webbläsaren och
 * i Node — mätskriptet använder den rakt av.
 */
import { FINGERPRINT_INSETS, fingerprintFromRgb, structFingerprintFromRgb } from "@/lib/art-fingerprint";
import { detectCardQuad, warpPerspective, RECTIFIED_H, RECTIFIED_W } from "@/lib/card-quad";

export interface PhotoFingerprints {
  fingerprints: string[];
  structFingerprints: string[];
}

/** Längsta sida som avtrycken räknas på — samma budget som skannerns. */
export const PHOTO_FP_MAX = 640;

function toB64(fp: Int8Array | Uint8Array): string {
  let bin = "";
  for (let i = 0; i < fp.length; i++) bin += String.fromCharCode(fp[i] & 0xff);
  return btoa(bin);
}

export function photoFingerprintsFromRgb(
  px: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  channels: 3 | 4
): PhotoFingerprints {
  const out: PhotoFingerprints = { fingerprints: [], structFingerprints: [] };
  const push = (p: Uint8Array | Uint8ClampedArray, pw: number, ph: number, ch: 3 | 4, inset = 0) => {
    const fp = fingerprintFromRgb(p, pw, ph, ch, inset);
    const sfp = structFingerprintFromRgb(p, pw, ph, ch, inset);
    if (!fp || !sfp) return;
    out.fingerprints.push(toB64(fp));
    out.structFingerprints.push(toB64(sfp));
  };

  const quad = detectCardQuad(px, w, h, channels);
  if (quad) {
    const warped = warpPerspective(px, w, h, channels, quad.corners);
    if (warped) {
      push(warped, RECTIFIED_W, RECTIFIED_H, 4);
      push(warped, RECTIFIED_W, RECTIFIED_H, 4, 0.04);
    }
  }
  for (const inset of FINGERPRINT_INSETS) push(px, w, h, channels, inset);
  return {
    fingerprints: out.fingerprints.slice(0, 8),
    structFingerprints: out.structFingerprints.slice(0, 8),
  };
}

/** Webbläsaren: data-URL → avtryck. null när bilden inte går att läsa. */
export async function photoFingerprints(dataUrl: string): Promise<PhotoFingerprints | null> {
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = dataUrl;
  });
  if (!img || !img.naturalWidth) return null;
  const scale = Math.min(1, PHOTO_FP_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const fps = photoFingerprintsFromRgb(ctx.getImageData(0, 0, w, h).data, w, h, 4);
  return fps.fingerprints.length > 0 ? fps : null;
}
