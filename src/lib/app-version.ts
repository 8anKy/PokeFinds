/**
 * Lägsta app-version vi vill att användarna kör — driver "Ny version finns"-remsan
 * i appen (`components/update-banner.tsx`).
 *
 * VARFÖR I WEBBEN: appen är ett tunt WebView-skal över foilio.se, så webben når
 * VARJE installerad version — även den som aldrig uppdaterats. Webben läser den
 * installerade versionen via `@capacitor/app` (med i binären sedan första bygget
 * 2026-06-15) och jämför. Ingen DB, inget nytt native-bygge för att tända remsan.
 *
 * **AUTOMATISK SEDAN 2026-09-02**: tröskeln är den version som FAKTISKT ligger i
 * App Store, läst ur Apples publika lookup-API av `/api/app/min-version`
 * (cachas i processen, ingen nyckel, ingen DB). Det svarar på exakt den fråga
 * en hårdkodad konstant inte kunde: "är den godkänd ÄN?" — remsan pekar aldrig
 * på en butikssida som fortfarande visar den gamla versionen, och ingen behöver
 * komma ihåg att höja ett tal efter varje granskning. ⚠️ Apples lookup släpar
 * ibland några timmar efter ett släpp; remsan är en knuff, inte en spärr.
 *
 * `MIN_APP_VERSION` är därför ett GOLV och reservvärdet när uppslaget inte
 * svarar — aldrig lägre än det här, och ingen skyldighet att höja det. Höjs det
 * ändå: bara marknadsversionen ("1.1"), aldrig build-numret, och FÖRST när den
 * är godkänd (ett golv över butikens version tänder remsan mot en version som
 * inte går att hämta).
 */
export const MIN_APP_VERSION = "1.1";

/** Bundle-id:t i App Store — samma som `appId` i capacitor.config.ts / BUNDLE_ID i codemagic.yaml. */
export const IOS_BUNDLE_ID = "se.foilio.app";

/**
 * Tröskeln remsan ska använda: butikens version om den är känd, tolkbar och
 * MINST golvet — annars golvet. Ren funktion; rutten och testerna delar den.
 */
export function resolveMinAppVersion(storeVersion: string | null | undefined, floor = MIN_APP_VERSION): string {
  if (!storeVersion) return floor;
  const cmp = compareVersions(storeVersion, floor);
  return cmp !== null && cmp > 0 ? storeVersion.trim() : floor;
}

function parts(v: string): number[] | null {
  const trimmed = v.trim();
  if (!/^\d+(\.\d+)*$/.test(trimmed)) return null;
  return trimmed.split(".").map((n) => Number.parseInt(n, 10));
}

/** Negativt om a < b, 0 om lika, positivt om a > b. `null` om någon inte är en version. */
export function compareVersions(a: string, b: string): number | null {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return null;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Sant BARA när den installerade versionen bevisligen är äldre än `MIN_APP_VERSION`.
 * Okänt/otolkbart ⇒ falskt: en remsa som tjatar på fel användare är värre än en
 * som uteblir.
 */
export function isOutdatedAppVersion(installed: string | null | undefined, min = MIN_APP_VERSION): boolean {
  if (!installed) return false;
  const cmp = compareVersions(installed, min);
  return cmp !== null && cmp < 0;
}
