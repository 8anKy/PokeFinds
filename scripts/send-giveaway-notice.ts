/**
 * MILSTOLPSUTSKICK — "vi passerade 100 medlemmar, kom och fira i Discord".
 *
 * Mallen bor i src/emails/templates.ts (`giveawayEmail`). Körs via
 * .github/workflows/giveaway-notice.yml.
 *
 * ⛔ STANDARDLÄGET ÄR FÖRHANDSGRANSKNING TILL ÄGAREN, ALDRIG MASSUTSKICK. Ett
 * massutskick går inte att ta tillbaka. Skarpt utskick kräver `--send-to-all`.
 *
 * ⛔ MEJLET BÄR ETT DATUM ("vi drar söndag 13 september"). Ett utskick EFTER det
 * datumet är värre än inget utskick — därför vägrar skriptet skicka skarpt när
 * dragningen har passerat. Flyttas dragningen: ändra `DRAW_DEADLINE` HÄR och
 * `drawDate` i mallen, annars glider de isär.
 *
 * Mottagare vid `--send-to-all`: konton med `notificationSettings.email = true`
 * (master) OCH `notificationSettings.news = true` (egen spak). ⛔ Båda med
 * `coalesce(..., true)`: saknas nyckeln i JSON:en är den PÅ, och ett
 * `= 'true'`-filter hade tyst hoppat över alla som aldrig rört reglaget.
 *
 * ⛔ AVANMÄLAN ÄR OBLIGATORISK: det här är marknadsföring, inte ett
 * driftmeddelande. Typen är `news` — ALDRIG `weekly`. Saknas
 * signeringshemligheten vägrar skriptet skicka, även förhandsgranskningen.
 *
 * Kör (bara via workflowet — RESEND_API_KEY finns inte lokalt):
 *   npx tsx scripts/send-giveaway-notice.ts                 # förhandsgranskning till ägaren
 *   npx tsx scripts/send-giveaway-notice.ts --send-to-all   # skarpt
 *   npx tsx scripts/send-giveaway-notice.ts --send-to-all --only=x@y.se
 */
import { prisma } from "@/lib/db";
import { providerFor, sendMail } from "@/lib/mailer";
import { giveawayEmail } from "@/emails/templates";
import { requireUnsubscribeSecret, unsubscribeUrl } from "@/lib/unsubscribe-token";

const OWNER = "milostheking88@gmail.com";
// `||`, inte `??`: workflowet kan sätta variabeln till TOM sträng (2026-08-16 gav
// det relativa länkar i veckobrevet). Apex, aldrig www.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://foilio.se";
const sendToAll = process.argv.includes("--send-to-all");
/** Skicka bara till EN adress — för att komplettera efter ett delvis misslyckat utskick. */
const only = /--only=(\S+)/.exec(process.argv.join(" "))?.[1];

/** Dragningen i mallen. Passerad ⇒ skarpt utskick vägras (se filhuvudet). */
const DRAW_DEADLINE = new Date("2026-09-13T18:00:00Z"); // 20.00 svensk tid

/**
 * ⛔ RESEND TAR MAX 10 REQUESTS/SEKUND. 150 ms mellan varje ger ~6,7/s med marginal;
 * ett 429 hade tyst lämnat en mottagare utan mejl (hände 2026-08-23).
 */
const SEND_GAP_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // ⛔ KONSOLLÄGE ÄR INTE ETT UTSKICK. Utan nyckel loggar `sendMail` och returnerar
  // utan fel — körningen blir grön och ingen får något.
  if (process.env.EMAIL_MODE === "console" || !providerFor({ lane: "bulk" })) {
    throw new Error(
      "Mailern går i konsolläge (EMAIL_MODE=console eller RESEND_API_KEY/BREVO_API_KEY saknas) — " +
        "utskicket avbryts hellre än rapporterar grönt utan att skicka något. " +
        "Kör via .github/workflows/giveaway-notice.yml."
    );
  }
  requireUnsubscribeSecret();
  if (sendToAll && Date.now() > DRAW_DEADLINE.getTime()) {
    throw new Error(
      `Dragningen (${DRAW_DEADLINE.toISOString()}) har passerat — mejlet bjuder in till något som redan är över. ` +
        "Flytta dragningen i mallen (`drawDate`) och i DRAW_DEADLINE, eller låt bli att skicka."
    );
  }
  console.log(`Leverantör för bulk-lanen: ${providerFor({ lane: "bulk" })}`);

  const recipients = await prisma.$queryRawUnsafe<{ id: string; email: string; name: string | null }[]>(
    `select id, email, name from "User"
     where coalesce((("notificationSettings")->>'email')::boolean, true) = true
       and coalesce((("notificationSettings")->>'news')::boolean, true) = true
     order by email`
  );
  console.log(`Mottagare med e-post + nyheter PÅ: ${recipients.length}`);

  const mailFor = (r: { id: string; name: string | null }, fallback: string) =>
    giveawayEmail({
      name: r.name?.split(" ")[0] ?? fallback,
      unsubscribeUrl: unsubscribeUrl(APP_URL, r.id, "news"),
    });

  if (!sendToAll) {
    // Förhandsgranskning: ETT mejl, till ägaren, med ägarens egen avanmälningslänk.
    const me = recipients.find((r) => r.email === OWNER);
    if (!me) throw new Error(`${OWNER} finns inte bland mottagarna — ingen förhandsgranskning att skicka.`);
    const mail = mailFor(me, "Milos");
    console.log(`\n--- FÖRHANDSGRANSKNING (skickas BARA till ${OWNER}) ---`);
    console.log(`Ämne: ${mail.subject}\n`);
    console.log(mail.text);
    const res = await sendMail({
      to: OWNER,
      subject: `[FÖRHANDSGRANSKNING] ${mail.subject}`,
      html: mail.html,
      text: mail.text,
      unsubscribeUrl: unsubscribeUrl(APP_URL, me.id, "news"),
      lane: "bulk",
    });
    console.log(`\nSkickat till ${OWNER} via ${res.provider ?? "?"}. Id: ${res.id ?? "(konsolläge — inget mejl skickades)"}`);
    console.log(`\nSkarpt utskick till ${recipients.length} mottagare: lägg till --send-to-all`);
    return;
  }

  const targets = only ? recipients.filter((r) => r.email === only) : recipients;
  if (only && targets.length === 0) throw new Error(`--only=${only} matchar ingen mottagare med nyheter PÅ.`);
  if (only) console.log(`--only=${only} → ${targets.length} mottagare`);

  let ok = 0,
    failed = 0;
  const retryable: string[] = [];
  for (const r of targets) {
    const mail = mailFor(r, "där");
    try {
      await sendMail({ ...mail, to: r.email, unsubscribeUrl: unsubscribeUrl(APP_URL, r.id, "news"), lane: "bulk" });
      ok++;
    } catch (e) {
      failed++;
      retryable.push(r.email);
      console.error(`FEL ${r.email}: ${String(e).slice(0, 120)}`);
    }
    await sleep(SEND_GAP_MS);
  }
  console.log(`Klart: ${ok} skickade, ${failed} misslyckades.`);
  // ⛔ EN TYST DELFRAMGÅNG ÄR DET FARLIGA UTFALLET. Skriv ut exakt vilka som ska
  // köras om, och FAILA rött — annars ser körningen grön ut och ingen kompletterar.
  if (failed > 0) {
    console.error(`\nKör om dessa: ${retryable.map((e) => `--only=${e}`).join(" ")}`);
    process.exitCode = 1;
  }
}

main().finally(() => prisma.$disconnect());
