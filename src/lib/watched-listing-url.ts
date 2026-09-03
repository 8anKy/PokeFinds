/**
 * VÄRDGRINDEN FÖR BEVAKADE LÄNKAR (`WatchedListing`).
 *
 * ⛔ Bor i lib, inte i route-filen: Next validerar exporterna ur en `route.ts` och
 * en hjälpfunktion där bryter bygget. Testet importerar också härifrån.
 *
 * ⛔ VARFÖR GRINDEN FINNS. Adminformuläret tar en URL och våra servrar hämtar den.
 * Utan en kontroll att URL:en hör till BUTIKEN är det en generell "hämta vad som
 * helst"-yta (SSRF: `http://169.254.169.254/…`, interna adresser) — och även utan
 * angripare hade en URL från fel butik bokförts som DEN butikens lagerstatus.
 */

/** Samma värd (eller underdomän) som butikens egen sajt? `www.` ignoreras. */
export function sameHost(retailerSite: string, target: string): boolean {
  try {
    const a = new URL(retailerSite).hostname.replace(/^www\./, "").toLowerCase();
    const b = new URL(target).hostname.replace(/^www\./, "").toLowerCase();
    if (!a || !b) return false;
    // ⛔ Punkten är kravet. Utan den matchar "goblinen.com.evil.example" på
    // "goblinen.com" — suffixattacken, och exakt det en naiv `includes` missar.
    return b === a || b.endsWith(`.${a}`) || a.endsWith(`.${b}`);
  } catch {
    return false;
  }
}
