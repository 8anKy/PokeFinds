/**
 * PROVPERIODENS UTSKICK (2026-10-19) — dag 7 värdebesked (push), dag 12 påminnelse
 * (mejl + push). Domen om VAD som ska ut bor i src/lib/trial-messages.ts (testad).
 *
 * ⛔ Körs av morgonrundan (/api/cron/alerts-due, 07:00 svensk tid) — aldrig egen cron:
 *    rundan väcker redan Neon en gång per dygn, och det här är två små frågor till.
 * ⛔ Påminnelsen stämplas FÖRST NÄR MEJLET GÅTT IVÄG. Ett mejlfel ⇒ nästa morgon igen
 *    (domen släpper den så länge det är ≥ 26 h kvar). Värdebeskedet stämplas alltid —
 *    en push som inte kom fram är ingen skada, och det ska aldrig komma två.
 * ⛔ Påminnelsen skickas oavsett mejlinställningen: den är ett besked om avtalet (pris
 *    och datum), inte marknadsföring.
 */
import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { pushToUser } from "@/lib/push-to-user";
import { trialReminderEmail } from "@/emails/templates";
import {
  trialEndLabel,
  trialMessageDue,
  trialPriceKind,
  trialUsageLine,
  trialUsageWorthShowing,
  type TrialUsage,
} from "@/lib/trial-messages";

const DAY_MS = 864e5;

export interface TrialMessagesResult {
  candidates: number;
  reminders: number;
  reminderFailures: number;
  values: number;
  valuesSkipped: number;
}

async function usageSince(userId: string, since: Date): Promise<TrialUsage> {
  const [scans, restockAlerts] = await Promise.all([
    prisma.scannerJob.count({ where: { userId, createdAt: { gte: since }, status: { not: "FAILED" } } }),
    prisma.alert.count({
      where: { userId, type: "RESTOCK", status: { in: ["SENT", "READ"] }, triggeredAt: { gte: since } },
    }),
  ]);
  return { scans, restockAlerts };
}

export async function runTrialMessages(now = new Date()): Promise<TrialMessagesResult> {
  const result: TrialMessagesResult = { candidates: 0, reminders: 0, reminderFailures: 0, values: 0, valuesSkipped: 0 };

  // EN fråga: alla pågående provperioder som inte fått sin påminnelse än.
  const users = await prisma.user.findMany({
    where: {
      trialEndsAt: { gt: now, lt: new Date(now.getTime() + 31 * DAY_MS) },
      trialReminderSentAt: null,
    },
    select: {
      id: true,
      email: true,
      name: true,
      trialStartedAt: true,
      trialEndsAt: true,
      trialSource: true,
      trialProductId: true,
      trialValueSentAt: true,
      trialReminderSentAt: true,
      rcWillRenew: true,
      stripeCancelAtPeriodEnd: true,
    },
  });
  result.candidates = users.length;

  for (const u of users) {
    const willRenew = u.trialSource === "STRIPE" ? u.stripeCancelAtPeriodEnd !== true : u.rcWillRenew;
    const due = trialMessageDue({ ...u, willRenew }, now);
    if (!due || !u.trialEndsAt) continue;

    const usage = u.trialStartedAt ? await usageSince(u.id, u.trialStartedAt) : { scans: 0, restockAlerts: 0 };

    if (due === "value") {
      if (trialUsageWorthShowing(usage)) {
        await pushToUser(u.id, {
          title: "Din första vecka med Pro",
          body: `${trialUsageLine(usage)}.`,
          url: "/samling",
        });
        result.values++;
      } else {
        result.valuesSkipped++;
      }
      await prisma.user.updateMany({ where: { id: u.id }, data: { trialValueSentAt: now } });
      continue;
    }

    const endLabel = trialEndLabel(u.trialEndsAt);
    const price = trialPriceKind(u.trialSource, u.trialProductId);
    const line = trialUsageWorthShowing(usage) ? trialUsageLine(usage) : null;
    try {
      await sendMail({
        to: u.email,
        ...trialReminderEmail({ name: u.name, endLabel, usageLine: line, price, source: u.trialSource }),
      });
    } catch (err) {
      result.reminderFailures++;
      console.error(`[trial-messages] påminnelsen till ${u.id} kunde inte skickas — försöker i morgon:`, err);
      continue;
    }
    await prisma.user.updateMany({ where: { id: u.id }, data: { trialReminderSentAt: now } });
    await pushToUser(u.id, {
      title: `Provperioden slutar ${endLabel}`,
      body:
        price === "commit-monthly"
          ? "Därefter 39 kr/mån i 12 månader (468 kr). Du behöver inte göra något för att behålla Pro."
          : "Därefter 465 kr för 12 månader. Du behöver inte göra något för att behålla Pro.",
      url: "/samling",
    });
    result.reminders++;
  }
  return result;
}
