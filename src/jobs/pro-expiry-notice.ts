/**
 * Varnar användare några dagar innan en GRATIS Pro-period (`bonusProUntil`) tar slut.
 *
 * ⛔ **VARFÖR DET HÄR JOBBET ÄR OBLIGATORISKT.** Restock-larm är Pro-only. När en
 * gratisperiod löper ut slutar larmen komma — utan ett ord. Användaren vet inte att
 * hen hade en provperiod som tog slut; hen drar slutsatsen att FOILIO ÄR TRASIGT.
 * Exakt det tysta bortfallet har redan inträffat en gång (RevenueCat-EXPIRATION
 * 2026-07-08 nollade planTier och tystade alla larm i fyra dygn innan någon förstod
 * varför). En kampanj som ger hundratals konton gratis Pro samtidigt skapar samma
 * tystnad i skala, fast planerat.
 *
 * ⛔ **BARA DEN SOM FAKTISKT FÖRLORAR NÅGOT MEJLAS.** Har användaren Pro från en
 * ANNAN källa (Stripe, app-köp, admin-roll) betyder ett utgånget `bonusProUntil`
 * ingenting alls — då vore mejlet direkt felaktigt, och skickat till en BETALANDE
 * kund ("din Pro tar slut") är det värre än inget mejl. isPro() utan bonusgrenen är
 * därför testet.
 *
 * Körs nattligt i scrape-all (Neon är redan vaken där — egen cron hade kostat en
 * extra väckning à minst 300 s).
 */
import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { proExpiringEmail } from "@/emails/templates";
import { isPro } from "@/lib/plan";

/** Hur många dagar före utgång varningen skickas. */
export const NOTICE_DAYS = 3;

/**
 * Bredare fönster än NOTICE_DAYS: jobbet kan missa en natt (röd körning, kö,
 * inställd cron) och då ska gårdagens grupp fortfarande få sitt mejl.
 */
const WINDOW_DAYS = 5;

/**
 * En gåva är minst en månad lång, så "varnad de senaste 20 dygnen" betyder
 * garanterat "varnad för DEN HÄR perioden". Enklare och tåligare än att försöka
 * lista ut när perioden började.
 */
const ALREADY_NOTIFIED_DAYS = 20;

export interface ProExpiryResult {
  candidates: number;
  sent: number;
  skippedOtherProSource: number;
  skippedEmailOff: number;
  failed: number;
}

export async function runProExpiryNotice(now = new Date()): Promise<ProExpiryResult> {
  const horizon = new Date(now.getTime() + WINDOW_DAYS * 864e5);
  const notifiedCutoff = new Date(now.getTime() - ALREADY_NOTIFIED_DAYS * 864e5);

  const users = await prisma.user.findMany({
    where: {
      bonusProUntil: { gt: now, lte: horizon },
      OR: [
        { proExpiryNotifiedAt: null },
        { proExpiryNotifiedAt: { lt: notifiedCutoff } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      planTier: true,
      bonusProUntil: true,
      stripeProUntil: true,
      notificationSettings: true,
    },
  });

  const result: ProExpiryResult = {
    candidates: users.length,
    sent: 0,
    skippedOtherProSource: 0,
    skippedEmailOff: 0,
    failed: 0,
  };

  for (const user of users) {
    // Skulle personen ha Pro ÄNDÅ när bonusen försvinner? Då förlorar hen inget.
    const proWithoutBonus = isPro({
      planTier: user.planTier,
      role: user.role,
      stripeProUntil: user.stripeProUntil,
      bonusProUntil: null,
    });
    if (proWithoutBonus) {
      result.skippedOtherProSource++;
      // Stämpla ändå: annars prövas raden varje natt fönstret igenom.
      await prisma.user.update({
        where: { id: user.id },
        data: { proExpiryNotifiedAt: now },
      });
      continue;
    }

    const settings = (user.notificationSettings ?? {}) as { email?: boolean };
    if (settings.email === false) {
      result.skippedEmailOff++;
      await prisma.user.update({
        where: { id: user.id },
        data: { proExpiryNotifiedAt: now },
      });
      continue;
    }

    const until = user.bonusProUntil!;
    const daysLeft = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 864e5));

    try {
      await sendMail({ to: user.email, ...proExpiringEmail(user.name, until, daysLeft) });
      // ⛔ Stämplas EFTER lyckat utskick. Stämplar man före tystas användaren av ett
      // tillfälligt mejlfel — samma regel som Discord-lanens markPosted.
      await prisma.user.update({
        where: { id: user.id },
        data: { proExpiryNotifiedAt: now },
      });
      result.sent++;
    } catch (e) {
      console.error(`[pro-expiry] Kunde inte mejla ${user.email}:`, e);
      result.failed++;
    }
  }

  console.log(
    `[pro-expiry] ${result.candidates} kandidater · ${result.sent} mejl · ` +
      `${result.skippedOtherProSource} har Pro från annan källa · ` +
      `${result.skippedEmailOff} har mejl avstängt · ${result.failed} fel`
  );
  return result;
}
