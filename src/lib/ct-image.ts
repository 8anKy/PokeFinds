/**
 * CardTraders blueprintbilder via vår proxy /api/ct-image/{blueprintId}?f={filnamn}
 * (se routen för varför). Ren modul — delas av routen och import-cm-only-singles.ts.
 */

/** Bara ett filnamn: bokstäver, siffror, - och _, en filändelse. Inga snedstreck. */
export function isValidCtImageFile(file: string): boolean {
  return /^[a-z0-9_-]{1,200}\.(jpe?g|png|webp)$/i.test(file);
}

/** Källan hos CardTrader — `show_`-versionen (~180 kB) i stället för originalet (~400 kB). */
export function ctImageSourceUrl(blueprintId: number, file: string): string {
  return `https://www.cardtrader.com/uploads/blueprints/image/${blueprintId}/show_${file}`;
}

/**
 * Blueprintets `image.url` ("/uploads/blueprints/image/357913/team-rocket-….jpg") →
 * vår proxy-URL, eller null om formen inte är den väntade.
 */
export function ctImageProxyUrl(blueprintId: number, imageUrl: string | null | undefined): string | null {
  const m = /^\/uploads\/blueprints\/image\/(\d+)\/([^/]+)$/.exec(imageUrl ?? "");
  if (!m || Number(m[1]) !== blueprintId || !isValidCtImageFile(m[2])) return null;
  return `/api/ct-image/${blueprintId}?f=${encodeURIComponent(m[2])}`;
}
