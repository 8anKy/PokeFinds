/**
 * Nattlig avstämning av Discord-rollerna.
 *
 * ⛔ DEN HÄR ÄR INTE VALFRI. Två av fyra Pro-källor i `isPro()` är DATUM
 * (`bonusProUntil`, `stripeProUntil`) och de löper ut UTAN att något event
 * fyras — ingen webhook, ingen kod som körs. Webhook-synken täcker bara de
 * ändringar någon leverantör berättar om; allt annat skulle betyda att en
 * Pro-roll satt kvar för alltid hos någon som slutade betala för ett halvår sen.
 *
 * ⛔ VI RÖR BARA KONTON MED `discordUserId`. Roller som ägaren delat ut för hand
 * i Discord är hens ensak — vi tar aldrig bort en roll vi inte satt. Skulle det
 * här jobbet i stället utgå från serverns medlemslista hade första körningen
 * strippat Pro från alla manuellt tilldelade medlemmar.
 *
 * Vi frågar Discord för VARJE länkat konto, även när inget ändrats. Det är hela
 * poängen med en avstämning: ett tillstånd vi bara läser ur vår egen databas
 * kan inte upptäcka att någon tagit bort rollen för hand i Discord.
 * ⚠️ Kostnaden är ett API-anrop per länkat konto och natt. Vid några tusen
 * länkade konton behöver det här bli inkrementellt (eller köras glesare) —
 * innan dess är det billigare än komplexiteten det skulle kosta att undvika.
 */
import { prisma, withDbRetry } from "@/lib/db";
import { mapPool } from "@/lib/concurrency";
import { discordEnabled } from "@/lib/discord";
import { syncDiscordRoles, DISCORD_SYNC_SELECT } from "@/services/discord-sync";

export interface DiscordReconcileResult {
  linked: number;
  pro: number;
  failed: number;
  skipped: boolean;
}

/**
 * ⛔ Lågt med flit. Discords hastighetsgränser är per bot, och en avstämning som
 * kör hårt riskerar att äta upp budgeten för de anrop som sker i realtid när
 * någon precis länkat sitt konto. Det här jobbet har hela natten på sig.
 */
const CONCURRENCY = 4;

export async function runDiscordReconcile(): Promise<DiscordReconcileResult> {
  if (!discordEnabled()) {
    console.log("[discord] integrationen är avstängd — hoppar över avstämningen.");
    return { linked: 0, pro: 0, failed: 0, skipped: true };
  }

  const users = await withDbRetry(() =>
    prisma.user.findMany({
      where: { discordUserId: { not: null } },
      select: DISCORD_SYNC_SELECT,
    })
  );

  let pro = 0;
  let failed = 0;
  await mapPool(users, CONCURRENCY, async (user) => {
    const result = await syncDiscordRoles(user, "Foilio: nattlig avstämning");
    if (result.pro) pro++;
    if (!result.ok) failed++;
  });

  console.log(
    `[discord] avstämning klar: ${users.length} länkade konton, ${pro} med Pro, ${failed} misslyckade.`
  );
  // ⛔ Kastar inte vid enstaka fel: ett 403 på ETT konto (t.ex. serverns ägare,
  // som ingen bot kan röra) skulle annars göra körningen röd varje natt och
  // avtrubba larmet för fel som faktiskt betyder något.
  return { linked: users.length, pro, failed, skipped: false };
}
