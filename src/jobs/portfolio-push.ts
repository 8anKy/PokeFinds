/**
 * VECKOPUSHEN OM SAMLINGEN (ägarbeslut 2026-10-13) — ersätter veckobrevet, som
 * kändes spammigt. En notis i veckan: samlingens värde, marknadens rörelse på det
 * man ägde för en vecka sedan och veckans största lyft. Text: src/lib/portfolio-push.ts.
 *
 * Mottagare: konton med registrerad enhet (`PushToken`), `push` OCH `portfolioPush`
 * på, och minst en post i samlingen. iOS via APNs, Android via FCM (lib/push.ts).
 *
 * ⛔ STEG i scrape-all.yml, aldrig egen cron: Neon är redan vaken i det fönstret och
 *    samlingsvärdet har frysts av nattens cardmarket-refresh. Jobbet avgör själv om
 *    det är rätt veckodag (UTC, PORTFOLIO_PUSH_WEEKDAY, default söndag).
 * ⛔ TYSTA TIMMAR: startar scrape-all före 07 svensk tid (schemat är ett golv, inte en
 *    starttid — men ibland är det i tid) hoppas veckan hellre över än att väcka folk.
 * ⛔ HÖGST EN GÅNG: markören stämplas FÖRE utskicket. En krasch mitt i kostar några
 *    missade notiser den veckan; en omkörning hade annars gett dubbletter.
 */
import { prisma } from "@/lib/db";
import { sendPush } from "@/lib/push";
import { parseNotificationSettings } from "@/lib/notification-settings";
import { portfolioPushMessage } from "@/lib/portfolio-push";
import { priceAlertQuietUntil } from "@/lib/quiet-hours";
import { utcDaysAgo } from "@/lib/utils";
import { computeCollectionValue } from "@/services/collection";

export const PORTFOLIO_PUSH_MARKER = "portfolio-push";

const WEEKDAY = (() => {
  // ⛔ Tom sträng (osatt repo-variabel i `env:`) ⇒ default, aldrig Number("") = 0.
  const raw = (process.env.PORTFOLIO_PUSH_WEEKDAY ?? "").trim();
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : 0;
})();

const HELD_SHARE_FOR_PERCENT = 0.9;
const MOVER_MIN_VALUE_ORE = 2_000;
const MOVER_MIN_PERCENT = 5;

/** 6 dygn, inte 7: scrape-all startar inte exakt samma minut varje vecka. */
const RESEND_WINDOW_MS = 6 * 864e5;

export interface PortfolioPushResult {
  skipped: "wrong-day" | "quiet-hours" | "already-sent" | null;
  candidates: number;
  sent: number;
  noValue: number;
}

export async function runPortfolioPush(
  now = new Date(),
  opts?: { force?: boolean; dryRun?: boolean; onlyUserId?: string }
): Promise<PortfolioPushResult> {
  const result: PortfolioPushResult = { skipped: null, candidates: 0, sent: 0, noValue: 0 };

  if (!opts?.force && now.getUTCDay() !== WEEKDAY) {
    console.log(`[portfolio-push] Fel veckodag (UTC ${now.getUTCDay()}, väntar på ${WEEKDAY}) — hoppar över.`);
    return { ...result, skipped: "wrong-day" };
  }
  if (!opts?.force && priceAlertQuietUntil(now) != null) {
    console.log("[portfolio-push] Tysta timmar i Sverige — hoppar över veckan hellre än att väcka någon.");
    return { ...result, skipped: "quiet-hours" };
  }

  // ⛔ Utan APNs-nyckel är sendPush en tyst no-op — då hade loggen sagt "skickad" om
  // notiser som aldrig lämnade huset (och markören bränt veckan). Hellre rött.
  // (Saknas bara FCM_SERVICE_ACCOUNT tappar Android-mottagarna — fcm.ts loggar inget då,
  //  så det står i Actions-steget att nyckeln ska finnas.)
  if (!opts?.dryRun && !process.env.APNS_KEY) {
    throw new Error("APNS_KEY saknas — ingen push kan skickas. Kör med --dry-run lokalt.");
  }

  const marker = await prisma.jobMarker.findUnique({ where: { key: PORTFOLIO_PUSH_MARKER } });
  if (!opts?.force && marker && now.getTime() - marker.at.getTime() < RESEND_WINDOW_MS) {
    console.log(`[portfolio-push] Redan skickad ${marker.at.toISOString()} — hoppar över.`);
    return { ...result, skipped: "already-sent" };
  }

  // EN fråga för hela mottagarlistan: enheter + inställningar, bara konton med poster.
  const tokens = await prisma.pushToken.findMany({
    where: {
      ...(opts?.onlyUserId ? { userId: opts.onlyUserId } : {}),
      user: { collectionItems: { some: {} } },
    },
    select: { userId: true, token: true, user: { select: { notificationSettings: true } } },
  });
  const byUser = new Map<string, string[]>();
  for (const t of tokens) {
    const s = parseNotificationSettings(t.user.notificationSettings);
    if (!s.push || !s.portfolioPush) continue;
    const list = byUser.get(t.userId);
    if (list) list.push(t.token);
    else byUser.set(t.userId, [t.token]);
  }
  result.candidates = byUser.size;

  if (!opts?.dryRun && !opts?.onlyUserId) {
    await prisma.jobMarker.upsert({
      where: { key: PORTFOLIO_PUSH_MARKER },
      update: { at: now },
      create: { key: PORTFOLIO_PUSH_MARKER, at: now },
    });
  }

  // Poster ägda före det här ögonblicket bär veckans marknadsrörelse. 8 dygn (inte 7)
  // så att varje sådan post garanterat finns med i seriens första punkt.
  const heldSince = utcDaysAgo(8);
  const invalid: string[] = [];

  for (const [userId, userTokens] of byUser) {
    try {
      const [all, held] = await Promise.all([
        computeCollectionValue(userId, { maxDays: 7, topItems: 0 }),
        computeCollectionValue(userId, { maxDays: 7, topItems: 0, ownedOnOrBefore: heldSince }),
      ]);
      let changeOre: number | null = null;
      let changePercent: number | null = null;
      const series = held.valueOverTime;
      if (series.length >= 8) {
        const last = series[series.length - 1].value;
        const prev = series[series.length - 8].value;
        if (prev > 0) {
          changeOre = last - prev;
          // Procenten gäller det som ägdes för en vecka sedan — visas bara när det är
          // (nästan) hela samlingen, annars bara kronorna.
          if (held.totalValue >= HELD_SHARE_FOR_PERCENT * all.totalValue) {
            changePercent = Math.round(((last - prev) / prev) * 1000) / 10;
          }
        }
      }
      // Billiga kort hoppar hundratals procent på några kronor — det är inget lyft.
      const top = all.movers.find((m) => (m.value ?? 0) >= MOVER_MIN_VALUE_ORE && m.percent >= MOVER_MIN_PERCENT);
      const msg = portfolioPushMessage({
        totalValueOre: all.totalValue,
        changeOre,
        changePercent,
        topMover: top ? { name: top.name, percent: top.percent } : null,
      });
      if (!msg) {
        result.noValue++;
        continue;
      }
      if (opts?.dryRun) {
        console.log(`[portfolio-push] TORR ${userId}: ${msg.body}`);
        result.sent++;
        continue;
      }
      const { invalidTokens } = await sendPush(userTokens, msg);
      invalid.push(...invalidTokens);
      if (invalidTokens.length < userTokens.length) result.sent++;
    } catch (err) {
      console.error(`[portfolio-push] ${userId} misslyckades:`, err instanceof Error ? err.message : err);
    }
  }

  if (invalid.length > 0) {
    await prisma.pushToken.deleteMany({ where: { token: { in: invalid } } }).catch(() => undefined);
  }
  console.log(
    `[portfolio-push] ${opts?.dryRun ? "TORRKÖRNING: " : ""}${result.sent} av ${result.candidates} fick notisen` +
      ` · ${result.noValue} utan värde · ${invalid.length} döda enheter städade.`
  );
  return result;
}
