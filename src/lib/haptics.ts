/**
 * Haptik — appens ENDA väg till vibration.
 *
 * Gester som inte har någon visuell kvittens behöver en fysisk: ett långtryck
 * som "tog" känns annars som att ingenting hände förrän panelen hinner upp, och
 * ett finger som drar längs prisgrafen ser inte sin egen träffpunkt (den ligger
 * under fingret). Vibrationen är alltså inte dekoration utan den enda
 * återkopplingen på att gesten registrerades.
 *
 * ⛔ TRE STYRKOR, INTE GODTYCKLIGA MILLISEKUNDER. Spridda `vibrate(37)` runt om
 * i koden ger en app som känns olika på olika ställen utan att någon bestämt det.
 * Lägg till en nivå här om en ny gest verkligen behöver en annan känsla — hitta
 * inte på ett tal på anropsstället.
 *
 * ⚠️ PLATTFORMSGAP: `navigator.vibrate` finns i Android Chrome och i
 * Android-WebViewen (dvs vår Capacitor-app), men INTE i iOS Safari eller
 * WKWebView — Apple exponerar inget vibrations-API för webben alls. På iPhone
 * händer alltså ingenting, tyst och utan fel. Ska iOS få haptik krävs
 * `@capacitor/haptics` (native-plugin ⇒ nytt native-bygge, inte bara en deploy).
 * Byggs det: implementera det HÄR, bakom samma tre funktioner, så inget
 * anropsställe behöver röras.
 */

/** Kort tick — "gesten registrerades". Långtryck som öppnar något, val i en lista. */
const TICK = 12;
/** Mjukare tick för svep/skrubb där händelserna kommer tätt. */
const GLIDE = 8;
/** Tydligare puls — "något blev klart" (en skanning träffade). */
const IMPACT = 60;

function buzz(ms: number): void {
  // Skyddad: `vibrate` saknas på iOS, och Chrome kastar dessutom om sidan inte
  // haft en användargest än. Haptik får aldrig kunna fälla ett anropsställe.
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ingen haptik på den här plattformen — inte ett fel */
  }
}

/** Långtryck tog, val gjordes. */
export function hapticTick(): void {
  buzz(TICK);
}

/**
 * Fingret gled till ett NYTT värde (grafens skrubb, en stegare som håller på).
 *
 * ⛔ Anropas per NYTT VÄRDE, aldrig per pixel. En vibration per pointermove är
 * hundratals i sekunden: telefonen surrar konstant, motorn hinner inte återgå
 * och batteriet betalar för det. Anroparen ska jämföra mot förra värdet först.
 */
export function hapticGlide(): void {
  buzz(GLIDE);
}

/** Något slutfördes (skanningen låste ett kort). */
export function hapticImpact(): void {
  buzz(IMPACT);
}
