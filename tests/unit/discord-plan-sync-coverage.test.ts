import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * VARJE väg som ändrar vem som har Pro måste synka Discord-rollen.
 *
 * Det här testet finns för att den listan visade sig vara LÄNGRE än den såg ut.
 * Kopplingen byggdes med synk på tre ställen (länkning, Stripe, RevenueCat) och
 * det kändes uttömmande — men `isPro()` har fyra källor, och två av dem skrivs
 * från helt andra ställen: adminpanelen (planTier + role) och referral-bonusen
 * (bonusProUntil). Ägaren satte Pro i adminpanelen 2026-08-08 och rollen dök
 * aldrig upp i Discord.
 *
 * ⛔ Felet är TYST i båda riktningarna: ingen krasch, inget loggat fel — bara en
 * roll som inte kommer, eller en som sitter kvar hos någon som slutat betala.
 *
 * ⛔ Listan är HANDSKRIVEN med flit. Ett försök att hitta plan-skrivningar med
 * en textsökning flaggade sju filer som bara LÄSER fälten (selects, typformer,
 * `proUserWhere`-filtret självt) — en vakt som falsklarmar blir ignorerad, och
 * då skyddar den ingenting. Skriver du en femte plan-väg: lägg den här.
 */
const PLAN_WRITERS = [
  "src/app/api/webhooks/stripe/route.ts", // stripeProUntil
  "src/app/api/webhooks/revenuecat/route.ts", // planTier
  "src/app/api/admin/users/[id]/route.ts", // planTier + role
  "src/services/invites.ts", // bonusProUntil (referral-Pro)
];

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("Discord-synk täcker alla plan-vägar", () => {
  it.each(PLAN_WRITERS)("%s anropar syncDiscordRoles", (rel) => {
    expect(read(rel)).toContain("syncDiscordRoles");
  });

  it("nattjobbet finns kvar som sista utväg", () => {
    // De fyra vägarna ovan täcker bara ändringar NÅGON UTFÖR. bonusProUntil och
    // stripeProUntil löper dessutom ut av sig själva, utan att någon kod körs —
    // det är enbart avstämningen som fångar det.
    const job = read("src/jobs/discord-reconcile.ts");
    expect(job).toContain("syncDiscordRoles");
    expect(read(".github/workflows/scrape-all.yml")).toContain("discord-reconcile-run.ts");
  });
});
