/**
 * Varför man hamnade på inloggningen — läst ur `callbackUrl`.
 *
 * Gästen som trycker på Portfölj eller Bevakningar i appen möttes av en naken
 * inloggningsvägg utan ett ord om vad som väntar bakom (Android-QA 2026-09-01,
 * fynd 6). Nyckeln pekar på `Auth.login.<key>`; okänd väg ⇒ null ⇒ ingen rad.
 * Ren funktion: callbackUrl:en kommer ur query-strängen och kan vara vad som helst.
 */
const HINTS: [prefix: string, key: string][] = [
  ["/samling", "hintCollection"],
  ["/bevakningar", "hintWatches"],
  ["/meddelanden", "hintMessages"],
  ["/forum/ny", "hintForumPost"],
  ["/forum/sparade", "hintForumSaved"],
  ["/gradera", "hintGrading"],
  ["/installningar", "hintSettings"],
  ["/mer", "hintMore"],
  ["/dashboard", "hintDashboard"],
];

export function loginHintKey(callbackUrl: string | null | undefined): string | null {
  if (!callbackUrl) return null;
  let path = callbackUrl;
  try {
    // Absolut URL ⇒ bara vägen räknas. Relativ ⇒ som den är.
    if (/^https?:\/\//i.test(callbackUrl)) path = new URL(callbackUrl).pathname;
  } catch {
    return null;
  }
  // Query/hash och språkprefix är inte en del av vägen vi matchar på.
  path = path.split(/[?#]/)[0].replace(/^\/en(?=\/|$)/, "");
  for (const [prefix, key] of HINTS) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return key;
  }
  return null;
}
