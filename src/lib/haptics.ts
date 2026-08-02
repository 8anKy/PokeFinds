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
 * TVÅ VÄGAR, I DEN HÄR ORDNINGEN:
 *  1. **Capacitor Haptics** (`@capacitor/haptics`) — native. Enda vägen på iOS:
 *     `navigator.vibrate` finns INTE i Safari/WKWebView, Apple exponerar inget
 *     vibrations-API för webben alls. Plugin:et talar med Taptic Engine och ger
 *     dessutom en bättre känsla på Android än en rå millisekundpuls.
 *  2. **`navigator.vibrate`** — webb/PWA och alla Android-webbläsare.
 *
 * ⛔ PLUGIN:ET NÅS VIA BRYGGAN (`Capacitor.Plugins.Haptics`), inte via en
 * `import`. Samma mönster som Keyboard-plugin:et i ui/bottom-sheet.tsx, och av
 * samma skäl: koden körs också på webben, där paketet inte har någon native-
 * sida. En statisk import hade dragit in modulen i webbuntet för en funktion
 * som ändå inte finns där. Saknas bryggan faller vi tyst till väg 2.
 *
 * ⚠️ **iOS kräver ett NYTT NATIVE-BYGGE.** Paketet ligger i package.json, men
 * native-sidan kommer först när `npx cap sync` har körts och appen byggts om
 * (Codemagic för iOS). En `git push` räcker INTE — till dess är iPhone tyst,
 * precis som förut, utan fel.
 */

/** Capacitor Haptics ImpactStyle — strängarna plugin:et förväntar sig. */
type ImpactStyle = "LIGHT" | "MEDIUM" | "HEAVY";

interface HapticsBridge {
  impact?: (opts: { style: ImpactStyle }) => Promise<void>;
  selectionChanged?: () => Promise<void>;
}

function bridge(): HapticsBridge | null {
  const plugins = (globalThis as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor
    ?.Plugins;
  return (plugins?.Haptics as HapticsBridge | undefined) ?? null;
}

/** Kort tick — "gesten registrerades". Långtryck som öppnar något, val i en lista. */
const TICK = 12;
/** Mjukare tick för svep/skrubb där händelserna kommer tätt. */
const GLIDE = 8;
/** Tydligare puls — "något blev klart" (en skanning träffade). */
const IMPACT = 60;

/**
 * @param ms  Fallback-pulsens längd när bara `navigator.vibrate` finns.
 * @param native  Vad plugin:et ska göra i stället, när det finns.
 */
function buzz(ms: number, native: (h: HapticsBridge) => Promise<void> | undefined): void {
  // Skyddat hela vägen: `vibrate` saknas på iOS, Chrome kastar om sidan inte
  // haft en användargest än, och plugin-anropet är async och kan avvisas på en
  // enhet utan vibrationsmotor. Haptik får ALDRIG fälla ett anropsställe — den
  // är kvittens, inte funktionalitet.
  try {
    const h = bridge();
    if (h) {
      void native(h)?.catch(() => undefined);
      return;
    }
    navigator.vibrate?.(ms);
  } catch {
    /* ingen haptik på den här plattformen — inte ett fel */
  }
}

/** Långtryck tog, val gjordes. */
export function hapticTick(): void {
  buzz(TICK, (h) => h.impact?.({ style: "LIGHT" }));
}

/**
 * Fingret gled till ett NYTT värde (grafens skrubb, en stegare som håller på).
 *
 * ⛔ Anropas per NYTT VÄRDE, aldrig per pixel. En vibration per pointermove är
 * hundratals i sekunden: telefonen surrar konstant, motorn hinner inte återgå
 * och batteriet betalar för det. Anroparen ska jämföra mot förra värdet först.
 */
export function hapticGlide(): void {
  // `selectionChanged` är precis den här gesten i plattformarnas egen vokabulär
  // (iOS selection feedback) — den är svagare och tätare tillåten än en impact,
  // vilket är vad ett finger som glider längs en graf ska kännas som.
  buzz(GLIDE, (h) => h.selectionChanged?.() ?? h.impact?.({ style: "LIGHT" }));
}

/** Något slutfördes (skanningen låste ett kort). */
export function hapticImpact(): void {
  buzz(IMPACT, (h) => h.impact?.({ style: "MEDIUM" }));
}
