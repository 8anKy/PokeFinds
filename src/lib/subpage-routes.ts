/**
 * Vilka rutter som är UNDERSIDOR i appen — sidor man går IN i från en flik och
 * TILLBAKA från med appens gemensamma bakåtcirkel (`BackCircle`).
 *
 * På mobil byter en undersida chrome: logotyphuvudet (`SiteHeader`) döljs och
 * sidans eget `SubpageHeader` (cirkel + titel) tar över raden under statusfältet.
 * Flikarnas rotsidor (Utforska, Portfölj, Skanna, Forum, Mer) behåller logotypen.
 * Desktop påverkas aldrig — där finns sidomenyn/toppnavigeringen och ingen cirkel.
 *
 * ⛔ EN lista, inte en flagga per sida: `SiteHeaderGate` läser den för att dölja
 * huvudet, och en sida som renderar `SubpageHeader` utan att stå här får DUBBEL
 * chrome på mobil (logotyp + cirkelrad). Vaktat av tests/unit/subpage-routes.test.ts.
 *
 * Sökvägarna är UTAN locale-prefix (`usePathname` från `@/i18n/navigation`).
 */
const EXACT = new Set([
  "/bevakningar",
  "/installningar",
  "/gradera",
  "/admin",
  "/priser",
  "/kontakt",
  "/forum/sparade",
  "/forum/ny",
  "/mer/utmarkelser",
  "/mer/bjud-in",
]);

const PREFIXES = ["/forum/g/", "/forum/t/", "/meddelanden/", "/produkter/", "/sets/"];

export function isSubpageRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  // Trailing slash och query ska inte spela roll.
  const p = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  if (EXACT.has(p)) return true;
  return PREFIXES.some((prefix) => p.startsWith(prefix) && p.length > prefix.length);
}
