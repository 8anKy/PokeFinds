/**
 * Är setets bild en riktig SETLOGOTYP? (ägaren 2026-10-16: japanska set visade kort,
 * boosterpåsar och butiksfoton i stället för en logga.)
 *
 * Inte en logga:
 *  · våra ritade tre-korts-brickor (`/set-logos/generated/`),
 *  · butiksfoton (Shopify-CDN:er, pocketmonsters.se),
 *  · leverantörens KORTBILDER: TCGGO lägger setloggor som `<set>.png` men ger för äldre
 *    japanska set ett kort (`dustox-lv-dp1-…-space-time-creation.webp`) — .webp/.jpg där.
 * Då ritas en namnbricka i stället (`SetNameTile`). Ren modul.
 */
export function isRealSetLogo(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.startsWith("/set-logos/generated/")) return false;
  if (/cdn\.shopify\.com|pocketmonsters\.se/i.test(url)) return false;
  if (/images\.tcggo\.com/i.test(url) && !/\.png(\?|$)/i.test(url)) return false;
  return true;
}

/** "Bandit Ring (XY7)" → { title: "Bandit Ring", code: "XY7" }. */
export function splitSetCode(name: string): { title: string; code: string | null } {
  const m = name.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  return m ? { title: m[1], code: m[2] } : { title: name, code: null };
}
