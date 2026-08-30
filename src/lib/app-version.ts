/**
 * Lägsta app-version vi vill att användarna kör — driver "Ny version finns"-remsan
 * i appen (`components/update-banner.tsx`).
 *
 * VARFÖR EN KONSTANT I WEBBEN: appen är ett tunt WebView-skal över foilio.se, så
 * webben når VARJE installerad version — även den som aldrig uppdaterats. Webben
 * läser den installerade versionen via `@capacitor/app` (med i binären sedan
 * första bygget 2026-06-15) och jämför mot talet här. Ingen server, ingen DB,
 * inget nytt native-bygge för att tända remsan.
 *
 * ⛔ HÖJ TILLSAMMANS MED `MARKETING_VERSION` I `codemagic.yaml` — men FÖRST när
 * versionen är GODKÄND och ligger i App Store. Höjs den för tidigt pekar remsan
 * på en butikssida som fortfarande visar den gamla versionen.
 *
 * ⛔ Bara marknadsversionen ("1.1"), aldrig build-numret: build-numret ökar för
 * varje TestFlight-bygge inom samma version.
 */
export const MIN_APP_VERSION = "1.1";

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
