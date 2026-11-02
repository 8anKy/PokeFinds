/**
 * GIVEAWAY-UTSKICKET 2026-11-02 (ägarbeslut): push + mejl om giveawayn med lotter
 * till alla som INTE redan anmält sig (`GiveawayEntry`). Mallen: `giveawayLaunchEmail`
 * i src/emails/templates.ts. Körs via .github/workflows/giveaway-launch-notice.yml.
 *
 * ⛔ STANDARDLÄGET ÄR FÖRHANDSGRANSKNING TILL ÄGAREN (mejl + push till ägarens enheter),
 *    ALDRIG MASSUTSKICK. Skarpt kräver `--send-to-all` och går inte att ta tillbaka.
 * ⛔ Vägrar skicka skarpt när giveawayn inte är öppen (`giveawayPhase`) — ett mejl om en
 *    stängd giveaway är värre än inget.
 * ⛔ Mottagare: mejl = `email` OCH `news` på; push = `push` OCH `news` på + registrerad
 *    enhet. `news` är spaken för marknadsföring — den som slagit av den får inget av det här.
 * ⛔ Push skickas aldrig under tysta timmar (22–07 svensk tid).
 *
 * Flaggor: --send-to-all · --only=<e-post> (bara mejlet, komplettering) · --skip-push · --skip-email
 */
import { prisma } from "@/lib/db";
import { providerFor, sendMail } from "@/lib/mailer";
import { giveawayLaunchEmail } from "@/emails/templates";
import { requireUnsubscribeSecret, unsubscribeUrl } from "@/lib/unsubscribe-token";
import { parseNotificationSettings } from "@/lib/notification-settings";
import { sendPush, type PushPayload } from "@/lib/push";
import { giveawayConfig, giveawayPhase, TICKETS } from "@/lib/giveaway";
import { priceAlertQuietUntil } from "@/lib/quiet-hours";
import { exitJob } from "@/lib/job-exit";

const OWNER = "milostheking88@gmail.com";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://scoutr.se";
const argv = process.argv.join(" ");
const sendToAll = process.argv.includes("--send-to-all");
const skipPush = process.argv.includes("--skip-push");
const skipEmail = process.argv.includes("--skip-email");
const only = /--only=(\S+)/.exec(argv)?.[1];

/** Resend tar max 10 requests/s — 150 ms ger ~6,7/s med marginal. */
const SEND_GAP_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PUSH: PushPayload = {
  title: "Vinn en 30th Celebration ETB 🎁",
  body: "Giveawayn är igång! Skanna kort och bjud in vänner för att samla lotter. Den stänger 17 november.",
  url: "/giveaway",
};

function closesLabel(at: Date): string {
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric", month: "long" }).format(at);
  const time = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" })
    .format(at)
    .replace(":", ".");
  return `${day} kl ${time}`;
}

async function main() {
  const now = new Date();
  const cfg = giveawayConfig();
  if (sendToAll && giveawayPhase(cfg, now) !== "open") {
    throw new Error(`Giveawayn är inte öppen (fas: ${giveawayPhase(cfg, now)}) — skickar inget.`);
  }
  if (!skipEmail) {
    if (process.env.EMAIL_MODE === "console" || !providerFor({ lane: "bulk" })) {
      throw new Error("Mailern går i konsolläge — avbryter hellre än rapporterar grönt utan att skicka. Kör via workflowet.");
    }
    requireUnsubscribeSecret();
  }
  if (!skipPush) {
    if (!process.env.APNS_KEY) throw new Error("APNS_KEY saknas — ingen push kan skickas.");
    if (!process.env.FCM_SERVICE_ACCOUNT) throw new Error("FCM_SERVICE_ACCOUNT saknas — Android hade tappats tyst.");
    if (priceAlertQuietUntil(now) != null) throw new Error("Tysta timmar i Sverige (22–07) — ingen push nu.");
  }

  const entered = new Set((await prisma.giveawayEntry.findMany({ select: { userId: true } })).map((e) => e.userId));
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, notificationSettings: true, pushTokens: { select: { token: true } } },
    orderBy: { email: "asc" },
  });
  const notEntered = users.filter((u) => !entered.has(u.id));
  const mailTo = notEntered.filter((u) => {
    const s = parseNotificationSettings(u.notificationSettings);
    return s.email && s.news;
  });
  const pushTo = notEntered.filter((u) => {
    const s = parseNotificationSettings(u.notificationSettings);
    return s.push && s.news && u.pushTokens.length > 0;
  });
  console.log(
    `Konton: ${users.length} · redan anmälda (utelämnas): ${entered.size} · mejl: ${mailTo.length} · push: ${pushTo.length}`
  );

  const mailFor = (u: { id: string; name: string | null }, fallback: string) =>
    giveawayLaunchEmail({
      name: u.name?.split(" ")[0] || fallback,
      unsubscribeUrl: unsubscribeUrl(APP_URL, u.id, "news"),
      tickets: TICKETS,
      closesLabel: closesLabel(cfg.closesAt),
    });

  if (!sendToAll) {
    const me = users.find((u) => u.email === OWNER);
    if (!me) throw new Error(`${OWNER} saknas — ingen förhandsgranskning.`);
    if (!skipEmail) {
      const mail = mailFor(me, "Milos");
      console.log(`\n--- FÖRHANDSGRANSKNING (bara ${OWNER}) ---\nÄmne: ${mail.subject}\n\n${mail.text}`);
      await sendMail({
        to: OWNER,
        subject: `[FÖRHANDSGRANSKNING] ${mail.subject}`,
        html: mail.html,
        text: mail.text,
        unsubscribeUrl: unsubscribeUrl(APP_URL, me.id, "news"),
        lane: "bulk",
      });
      console.log(`Mejl skickat till ${OWNER}.`);
    }
    if (!skipPush) {
      const tokens = me.pushTokens.map((t) => t.token);
      if (tokens.length === 0) console.log("Ägaren har ingen registrerad enhet — ingen provnotis.");
      else {
        const { invalidTokens } = await sendPush(tokens, PUSH);
        console.log(`Provnotis till ägarens ${tokens.length - invalidTokens.length} av ${tokens.length} enheter.`);
      }
    }
    console.log(`\nSkarpt: --send-to-all (${mailTo.length} mejl, ${pushTo.length} push).`);
    return;
  }

  let failed = 0;
  if (!skipPush && !only) {
    let ok = 0;
    const invalid: string[] = [];
    for (const u of pushTo) {
      const tokens = u.pushTokens.map((t) => t.token);
      try {
        const { invalidTokens } = await sendPush(tokens, PUSH);
        invalid.push(...invalidTokens);
        if (invalidTokens.length < tokens.length) ok++;
      } catch (e) {
        console.error(`PUSH-FEL ${u.id}: ${String(e).slice(0, 120)}`);
      }
    }
    if (invalid.length) await prisma.pushToken.deleteMany({ where: { token: { in: invalid } } }).catch(() => undefined);
    console.log(`Push: ${ok} av ${pushTo.length} konton nådda · ${invalid.length} döda enheter städade.`);
  }

  if (!skipEmail) {
    const targets = only ? mailTo.filter((u) => u.email === only) : mailTo;
    if (only && targets.length === 0) throw new Error(`--only=${only} matchar ingen mottagare.`);
    let ok = 0;
    const retry: string[] = [];
    for (const u of targets) {
      const mail = mailFor(u, "där");
      try {
        await sendMail({ ...mail, to: u.email, unsubscribeUrl: unsubscribeUrl(APP_URL, u.id, "news"), lane: "bulk" });
        ok++;
      } catch (e) {
        failed++;
        retry.push(u.email);
        console.error(`MEJL-FEL ${u.email}: ${String(e).slice(0, 120)}`);
      }
      await sleep(SEND_GAP_MS);
    }
    console.log(`Mejl: ${ok} skickade, ${failed} misslyckades.`);
    if (failed) console.error(`Kör om (med skip_push): ${retry.map((e) => `--only=${e}`).join(" ")}`);
  }
  if (failed) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => exitJob(process.exitCode === 1 ? 1 : 0));
