/**
 * ENGÅNGSUTSKICK: "restock-larmen via mejl är pausade" (2026-08-23).
 *
 * ⛔ STANDARDLÄGET ÄR FÖRHANDSGRANSKNING TILL ÄGAREN, ALDRIG MASSUTSKICK. Ett
 * massutskick går inte att ta tillbaka, och det här mejlet meddelar en
 * FÖRSÄMRING — formuleringen måste vara godkänd av en människa först. Skarpt
 * utskick kräver `--send-to-all` OCH en bekräftad mottagarlista i utskriften.
 *
 * Mottagare vid `--send-to-all`: konton med `notificationSettings.email = true`.
 * ⛔ `coalesce(..., true)` av samma skäl som defaulten i schemat: saknas nyckeln
 * i JSON:en är e-post PÅ, och ett `= 'true'`-filter hade tyst hoppat över dem.
 *
 * Kör:
 *   node scripts/with-prod-db.mjs npx tsx scripts/send-restock-paused-notice.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/send-restock-paused-notice.ts --send-to-all
 */
import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { restockPausedEmail } from "@/emails/templates";

const OWNER = "milostheking88@gmail.com";
const sendToAll = process.argv.includes("--send-to-all");

async function main() {
  // ⛔ KONSOLLÄGE ÄR INTE ETT UTSKICK. Utan RESEND_API_KEY (och utan
  // NODE_ENV=production, vilket tsx i Actions inte har) LOGGAR `sendMail` mejlet och
  // returnerar UTAN fel — körningen blir grön och ingen får något. Samma lögn som
  // Discord-provutskicket 2026-08-14 och veckobrevets egen vakt finns för att
  // förhindra. Gäller BÅDA lägena: en förhandsgranskning som aldrig når ägarens
  // inkorg är lika värdelös som ett massutskick som inte går iväg.
  if (process.env.EMAIL_MODE === "console" || !process.env.RESEND_API_KEY) {
    throw new Error(
      "Mailern går i konsolläge (EMAIL_MODE=console eller RESEND_API_KEY saknas) — " +
        "utskicket avbryts hellre än rapporterar grönt utan att skicka något. " +
        "RESEND_API_KEY finns bara i Railway och som Actions-secret, INTE i .env: " +
        "kör via .github/workflows/restock-paused-notice.yml."
    );
  }

  const recipients = await prisma.$queryRawUnsafe<{ id: string; email: string; name: string | null }[]>(
    `select id, email, name from "User"
     where coalesce((("notificationSettings")->>'email')::boolean, true) = true
     order by email`
  );
  console.log(`Mottagare med e-post PÅ: ${recipients.length}`);

  if (!sendToAll) {
    // Förhandsgranskning: ETT mejl, till ägaren, med ägarens eget namn.
    const me = recipients.find((r) => r.email === OWNER);
    const mail = restockPausedEmail(me?.name?.split(" ")[0] ?? "Milos");
    console.log(`\n--- FÖRHANDSGRANSKNING (skickas BARA till ${OWNER}) ---`);
    console.log(`Ämne: ${mail.subject}\n`);
    console.log(mail.text);
    const res = await sendMail({ to: OWNER, subject: `[FÖRHANDSGRANSKNING] ${mail.subject}`, html: mail.html, text: mail.text });
    console.log(`\nSkickat till ${OWNER}. Resend-id: ${res.id ?? "(konsolläge — inget mejl skickades)"}`);
    console.log(`\nSkarpt utskick till ${recipients.length} mottagare: lägg till --send-to-all`);
    return;
  }

  let ok = 0, failed = 0;
  for (const r of recipients) {
    const mail = restockPausedEmail(r.name?.split(" ")[0] ?? "där");
    try {
      // ⛔ MEDVETET UTAN `unsubscribeUrl`. Två skäl, och de drar åt samma håll:
      //
      // 1. `UnsubscribeType` har EXAKT ETT värde — "weekly" (lib/unsubscribe-token.ts).
      //    Att återanvända det här hade gett mottagaren en knapp som säger "sluta
      //    skicka det här" men som i själva verket avanmäler VECKOBREVET. En
      //    avregistreringslänk som stänger av fel sak är värre än ingen alls.
      // 2. Det här ÄR ingen marknadsföring: det är ett driftmeddelande om en
      //    funktion på mottagarens EGET konto som slutat fungera. Sådana får (och
      //    bör) gå ut till befintliga användare utan avanmälan — jämför
      //    lösenordsåterställning, inte veckobrevet.
      //
      // Behöver utskicket ändå en avanmälan: lägg till en EGEN typ i
      // UnsubscribeType + TYPES och hantera den i /api/unsubscribe. Återanvänd
      // ALDRIG "weekly".
      await sendMail({ ...mail, to: r.email });
      ok++;
    } catch (e) {
      failed++;
      console.error(`FEL ${r.email}: ${String(e).slice(0, 120)}`);
    }
  }
  console.log(`Klart: ${ok} skickade, ${failed} misslyckades.`);
}

main().finally(() => prisma.$disconnect());
