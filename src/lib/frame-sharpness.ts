/**
 * FÅNGSTKVALITET — hur skarp är videorutan vi är på väg att döma på?
 *
 * ⛔ **VARFÖR DEN HÄR FILEN FINNS: TAKTEN ÄR DEN ENDA FÖRKLARINGEN I DATAN MED
 * EN MEKANISM.** Revisionen 2026-08-29 (163 missade skanningar, dvs kort som låg
 * utanför bildens topp-15) letade efter en KATALOGorsak och hittade ingen:
 *   · gamla WotC-ramar faller inte ur — 12,6 % miss, BÄST av alla eror
 *   · fullart/illustration rare faller inte ur — 12,5–15,4 %, bäst av alla raritetsklasser
 *   · 0 saknade eller felaktiga avtryck (20 563/20 563 kort har både art- och struktur)
 *   · ingen attraktor-bugg (92,6 % unika topp-1 bland missarna)
 *   · inte "rätt konst, fel tryckning" — likheten till det valda kortet låg på
 *     SLUMPBASLINJE (median 0,624 mot 0,610 för 15 slumpkort)
 * Det som DÄREMOT föll ut, monotont och inom BÅDA de tunga användarna:
 *   < 1,5 s mellan skanningar → 34,1 % miss (60/176)
 *   > 60 s mellan skanningar → 15,3 % miss (9/59)
 * Och 2 av 24 användare bar 130 av 163 missar, stabilt över 6 dygn och ALLA
 * kortkategorier — dvs en enhets-/ljus-/handlagsegenskap, inte en katalogegenskap.
 * Informationen fanns aldrig i fångsten. Ingen omrankning, inget större K
 * (rang 6–15 rymmer 3,9 % av raderna) och inget finare rutnät (redan MÄTT sämre)
 * hämtar in den. Enda spaken är att inte döma på en dålig ruta.
 *
 * Måttet är NORMALISERAD MEDELGRADIENT: medelvärdet av |Δluminans| mot höger och
 * nedåt, delat med medelluminansen. Divisionen är det som gör det användbart —
 * ett rått gradientmått rankar en ljus bild över en mörk oavsett skärpa, och
 * skannern används både i solljus och i soffan.
 *
 * ⚠️ **RÄKNAS PÅ DEN REDAN NEDSKALADE AVTRYCKSBUFFERTEN** (≤640 px, se
 * FINGERPRINT_SOURCE_MAX) — samma pixelläsning som konstavtrycket, alltså noll
 * extra `getImageData`. Nedskalningen suddar per definition bort den finaste
 * detaljen, så måttet ser inte lätt feloskärpa. Det spelar ingen roll för det vi
 * jagar: rörelseoskärpa från en hand som redan är på väg till nästa kort är
 * storskalig och överlever nedskalningen med god marginal.
 */

/**
 * @param px   RGBA-buffert (canvas `getImageData().data`).
 * @param w    Bredd i pixlar.
 * @param h    Höjd i pixlar.
 * @param step Antal byte per pixel (4 för RGBA). Egen parameter av samma skäl som
 *             `fingerprintFromRgb`: servern läser 3 kanaler (sharp), klienten 4.
 * @returns Normaliserad medelgradient ≥ 0, eller null när ytan är för liten eller
 *          helt svart. ⛔ **null är inte 0.** 0 betyder "helt jämn yta" (ett vitt
 *          papper), null betyder "gick inte att mäta" — och en nolla som smyger
 *          in där null hörde hemma är exakt det fel `priceOreFromEur` finns för.
 */
export function frameSharpness(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  step = 4
): number | null {
  if (w < 3 || h < 3) return null;

  let gradSum = 0;
  let lumSum = 0;
  let n = 0;

  // Luminans direkt ur RGB (Rec. 601-vikter i heltal, samma billiga form som
  // resten av bildkoden här). Kanterna hoppas över: gradienten mot en pixel som
  // inte finns är inte noll, den är odefinierad.
  const lum = (i: number) => (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = (y * w + x) * step;
      const c = lum(i);
      gradSum += Math.abs(lum(i + step) - c) + Math.abs(lum(i + w * step) - c);
      lumSum += c;
      n++;
    }
  }

  if (n === 0) return null;
  const meanLum = lumSum / n;
  // En helt svart ruta (locket på, fingret över linsen) har ingen skärpa att tala
  // om — och divisionen hade sprängt talet mot oändligheten.
  if (meanLum < 1) return null;
  return gradSum / n / meanLum;
}

/**
 * ⛔ **TRÖSKELN ÄR OKALIBRERAD OCH GRINDAR DÄRFÖR BARA AUTO-SLUTAREN.**
 *
 * Vi har inga uppmätta skärpetal från fältet — måttet börjar bokföras
 * (`recall.sharp`) samtidigt som den här filen läggs till, och först när
 * fördelningen finns går tröskeln att sätta på DATA i stället för på en gissning.
 * Talet nedan är valt lågt med flit: det ska fånga uppenbar rörelseoskärpa, inte
 * sortera bland dugliga rutor.
 *
 * ⛔ **DEN FÅR ALDRIG BLOCKERA ETT MANUELLT SLUTARTRYCK.** Ett tryck är ett
 * uttryckligt beslut av användaren, och en kamera som vägrar fotografera är
 * trasig — inte försiktig. Auto-slutaren är däremot VÅR timing, och att avstå
 * där kostar användaren ingenting: uteblir den trycker hen själv, precis som
 * innan auto-fångsten fanns.
 */
export const SHARP_AUTO_MIN = 0.04;
