/**
 * ENGÅNGSUTSKICK: inbjudan till Foilios Discord.
 *
 * ⛔ TORRKÖRNING ÄR DEFAULT. Ett mejl går inte att ta tillbaka, och varje utskick
 * till en död adress är en hård studs mot foilio.se:s avsändarrykte — med 18
 * mottagare finns ingen "statistisk" marginal, en enda studs är 5 % av volymen.
 *
 * ⛔ MOTTAGARURVALET RESPEKTERAR `notificationSettings.email`. Det är den enda
 * avanmälan användaren har (samma spak som `dispatchPendingAlerts` läser), så att
 * gå förbi den här hade gjort inställningen till en lögn.
 *
 * ⛔ SKICKAR BARA TILL VERIFIERADE ADRESSER. En overifierad adress kan vara
 * felstavad eller någon annans — den har aldrig bevisat att den vill höra av oss.
 *
 * Kör:
 *   npx tsx scripts/preview-email.ts                      # se mejlet i webbläsaren
 *   node scripts/with-prod-db.mjs npx tsx scripts/send-discord-invite.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/send-discord-invite.ts --to=milos@exempel.se --apply
 *   node scripts/with-prod-db.mjs npx tsx scripts/send-discord-invite.ts --apply
 */
import "./load-env";
import { prisma } from "@/lib/db";
import { sendMail, isPermanentMailError } from "@/lib/mailer";
import { discordInviteEmail } from "@/emails/templates";
import { parseNotificationSettings } from "@/lib/notification-settings";
import { DISCORD_URL } from "@/lib/social-links";

const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.find((a) => a.startsWith("--to="))?.slice("--to=".length);
/**
 * Adresser som redan fått mejlet — typiskt provutskicket till en själv.
 * Skriptet för ingen egen logg över vad som skickats (en tabell för ETT
 * engångsutskick vore mer kod att underhålla än värdet), så dubblettskyddet är
 * den här listan. ⛔ Kör aldrig den fulla omgången utan den efter ett provutskick.
 */
const SKIP = new Set(
  (process.argv.find((a) => a.startsWith("--skip="))?.slice("--skip=".length) ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);
/** Paus mellan utskick — Resend tar 2 req/s. */
const GAP_MS = 600;

async function main() {
  const users = await prisma.user.findMany({
    where: { emailVerifiedAt: { not: null }, email: { not: "" } },
    select: { id: true, name: true, email: true, notificationSettings: true },
    orderBy: { createdAt: "asc" },
  });

  let recipients = users.filter(
    (u) =>
      parseNotificationSettings(u.notificationSettings).email &&
      !SKIP.has(u.email.toLowerCase())
  );
  if (ONLY) {
    recipients = recipients.filter((u) => u.email.toLowerCase() === ONLY.toLowerCase());
    if (recipients.length === 0) {
      console.error(`Ingen mejlbar, verifierad användare med adressen ${ONLY}.`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(
    `${users.length} verifierade konton · ${recipients.length} mottagare efter e-post-toggeln${
      ONLY ? ` · begränsat till ${ONLY}` : ""
    }`
  );
  console.log(`Inbjudan: ${DISCORD_URL}`);
  console.log(`Ämne:     ${discordInviteEmail("Namn").subject}\n`);

  if (!APPLY) {
    for (const u of recipients) console.log(`  [torrkörning] ${u.email} (${u.name})`);
    console.log(`\nInget skickat. Lägg till --apply när du vill skicka på riktigt.`);
    return;
  }

  // ⛔ KONSOLLÄGE ÄR INTE ETT UTSKICK. Lokalt står `EMAIL_MODE=console` i .env och
  // `RESEND_API_KEY` finns bara i Railway/Actions — då loggar `sendMail` mejlet och
  // returnerar utan fel, så loopen nedan rapporterar "✓ skickat" för varenda
  // mottagare utan att ett enda mejl lämnat maskinen. Det HÄNDE vid provutskicket
  // 2026-08-14. Samma familj som mailerns egen regel om saknad nyckel i produktion:
  // ett tyst lyckat no-op är värre än ett fel, för då tror både du och koden att
  // mejlet är på väg. Kör hellre via .github/workflows/discord-invite.yml, där
  // nyckeln redan är en secret.
  if (process.env.EMAIL_MODE === "console" || !process.env.RESEND_API_KEY) {
    console.error(
      [
        "AVBRUTET: mailern går i konsolläge — inga mejl skulle lämna maskinen.",
        `  EMAIL_MODE  = ${process.env.EMAIL_MODE ?? "(osatt)"}`,
        `  RESEND_API_KEY satt = ${!!process.env.RESEND_API_KEY}`,
        "",
        'Kör utskicket via workflowet "Discord-inbjudan (manuell)" i GitHub Actions,',
        "där RESEND_API_KEY redan finns som secret.",
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }

  let sent = 0;
  for (const u of recipients) {
    const mail = discordInviteEmail(u.name);
    try {
      await sendMail({ to: u.email, subject: mail.subject, html: mail.html, text: mail.text });
      sent++;
      console.log(`  ✓ ${u.email}`);
    } catch (err) {
      console.error(`  ✗ ${u.email}: ${String(err)}`);
      // Permanent fel = adressen/innehållet blir aldrig rätt. Fortsätt inte blint
      // igenom listan och samla på studsar — samma regel som dispatchPendingAlerts.
      if (isPermanentMailError(err)) {
        console.error("Permanent fel — avbryter resten av utskicket.");
        process.exitCode = 1;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  console.log(`\nSkickat: ${sent} av ${recipients.length}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
