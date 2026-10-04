/**
 * GRADERINGSFOTOT FÖRBEREDS PÅ TELEFONEN (2026-10-04, ägarönskan "ladda upp från
 * kamerarullen" + skademarkeringarna).
 *
 * Varje foto — kamera ELLER kamerarulle — avkodas och ritas om till en JPEG:
 *  1. ORIENTERINGEN BAKAS IN. En iPhone-bild är ofta lagrad liggande med en
 *     EXIF-flagga "rotera 90°". Webbläsaren visar den rätt, men modellen får de råa
 *     pixlarna — och skadornas rutor (0–1000 på bilden modellen såg) hamnade då på
 *     fel ställe på bilden användaren ser. Efter omritningen är de två samma bild.
 *  2. LÄNGSTA SIDAN KAPAS TILL `GRADING_PHOTO_MAX`. Kamerarullens bilder (48 MP,
 *     ofta > 5 MB) avvisades förut. Båda leverantörerna skalar själva ned långt
 *     under 2400 px (Claude ~1568 px, Gemini 3 per mediaupplösning), så kapningen
 *     ändrar varken kostnad eller vad modellen ser — bara uppladdningens storlek.
 *
 * `autoCropCard` skär ut kortet ur ett foto (delningens "Mitt foto" när
 * centreringen inte mätts) med skannerns validerade hörnsökare. Hittas inget
 * säkert fyrhörn ⇒ null, och anroparen tar råfotot — en felaktig varp vore värre.
 */
import { detectCardQuad } from "@/lib/card-quad";
import { CARD_ASPECT, homography, warpPerspective } from "@/lib/perspective";

/** Längsta sidan som skickas till modellen och visas med skademarkeringar. */
export const GRADING_PHOTO_MAX = 2400;
/** Råfilens tak — långt över vad en telefonkamera ger, under vad som låser en flik. */
export const GRADING_RAW_MAX_BYTES = 40 * 1024 * 1024;
const JPEG_QUALITY = 0.9;

/** Storlek som ryms inom `max` på längsta sidan, aldrig uppskalad. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode"));
    img.src = src;
  });
}

/**
 * Fil → JPEG-data-URL med inbakad orientering och kapad storlek. Kastar när bilden
 * inte går att avkoda (t.ex. HEIC i en webbläsare som saknar avkodare).
 */
export async function prepareGradingPhoto(file: File): Promise<string> {
  // Bildelementet tillämpar EXIF-orienteringen när det ritas på en canvas (alla
  // nutida webbläsare, `image-orientation: from-image` är standard).
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);
    const { w, h } = fitWithin(img.naturalWidth, img.naturalHeight, GRADING_PHOTO_MAX);
    if (!w || !h) throw new Error("decode");
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Analysbildens längsta sida för hörnsökningen (den skalar själv ned internt). */
const CROP_ANALYSIS_MAX = 1200;
/** Utsnittets bredd — skarpt nog för en story-bild. */
const CROP_WIDTH = 720;

/** Kortet ur fotot, uträtat till 63:88. null = inget säkert fyrhörn. */
export async function autoCropCard(dataUrl: string): Promise<string | null> {
  try {
    const img = await loadImg(dataUrl);
    const { w, h } = fitWithin(img.naturalWidth, img.naturalHeight, CROP_ANALYSIS_MAX);
    if (!w || !h) return null;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const src = ctx.getImageData(0, 0, w, h);
    const quad = detectCardQuad(src.data, w, h, 4);
    if (!quad) return null;
    const outW = CROP_WIDTH;
    const outH = Math.round(CROP_WIDTH / CARD_ASPECT);
    const dst = [
      { x: 0, y: 0 },
      { x: outW, y: 0 },
      { x: outW, y: outH },
      { x: 0, y: outH },
    ];
    const H = homography(
      dst,
      quad.corners.map(([x, y]) => ({ x, y }))
    );
    if (!H) return null;
    const out = warpPerspective({ data: src.data, width: w, height: h }, H, outW, outH);
    const o = document.createElement("canvas");
    o.width = outW;
    o.height = outH;
    const octx = o.getContext("2d");
    if (!octx) return null;
    const id = octx.createImageData(outW, outH);
    id.data.set(out);
    octx.putImageData(id, 0, 0);
    return o.toDataURL("image/jpeg", JPEG_QUALITY);
  } catch {
    return null;
  }
}
