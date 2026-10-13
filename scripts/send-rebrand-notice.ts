/**
 * NAMNBYTESUTSKICK — "Foilio heter nu Scoutr" (2026-10-13).
 *
 * Mallen: src/emails/templates.ts (`rebrandEmail`). Körs via
 * .github/workflows/rebrand-notice.yml (RESEND_API_KEY finns bara där).
 *
 * ⛔ STANDARDLÄGET ÄR FÖRHANDSGRANSKNING TILL ÄGAREN. Skarpt kräver `--send-to-all`.
 * Mottagare: `notificationSettings.email` OCH `.news` påslagna (coalesce → true).
 * ⛔ Avanmälan är obligatorisk (typ `news`).
 *
 *   npx tsx scripts/send-rebrand-notice.ts                 # förhandsgranskning
 *   npx tsx scripts/send-rebrand-notice.ts --send-to-all   # skarpt
 *   npx tsx scripts/send-rebrand-notice.ts --send-to-all --only=x@y.se
 */
import { prisma } from "@/lib/db";
import { providerFor, sendMail } from "@/lib/mailer";
import { rebrandEmail } from "@/emails/templates";
import { requireUnsubscribeSecret, unsubscribeUrl } from "@/lib/unsubscribe-token";

const OWNER = "milostheking88@gmail.com";
// `||`, inte `??`: workflowet kan sätta variabeln till TOM sträng (2026-08-16 gav
// det relativa länkar i veckobrevet). Apex, aldrig www.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://scoutr.se";
const sendToAll = process.argv.includes("--send-to-all");
/** Skicka bara till EN adress — för att komplettera efter ett delvis misslyckat utskick. */
const only = /--only=(\S+)/.exec(process.argv.join(" "))?.[1];


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
        "Kör via .github/workflows/rebrand-notice.yml."
    );
  }
  requireUnsubscribeSecret();
  console.log(`Leverantör för bulk-lanen: ${providerFor({ lane: "bulk" })}`);

  const recipients = await prisma.$queryRawUnsafe<{ id: string; email: string; name: string | null }[]>(
    `select id, email, name from "User"
     where coalesce((("notificationSettings")->>'email')::boolean, true) = true
       and coalesce((("notificationSettings")->>'news')::boolean, true) = true
     order by email`
  );
  console.log(`Mottagare med e-post + nyheter PÅ: ${recipients.length}`);

  const mailFor = (r: { id: string; name: string | null }, fallback: string) =>
    rebrandEmail({
      name: r.name?.split(" ")[0] ?? fallback,
      unsubscribeUrl: unsubscribeUrl(APP_URL, r.id, "news"),
    });

  if (!sendToAll) {
    // Förhandsgranskning: ETT mejl, till ägaren, med ägarens egen avanmälningslänk.
    // Ägaren kan ha nyhetsmejl AV (eller ett annat inloggningskonto) — förhandsgranskningen
    // går ändå till OWNER, med avanmälningslänken från ägarens konto om det finns, annars
    // från första SUPERADMIN (länken är bara till för att se att den renderas).
    const me =
      recipients.find((r) => r.email === OWNER) ??
      (await prisma.user.findFirst({
        where: { OR: [{ email: OWNER }, { role: "SUPERADMIN" }] },
        select: { id: true, email: true, name: true },
        orderBy: { createdAt: "asc" },
      }));
    if (!me) throw new Error("Hittade varken ägarkontot eller en SUPERADMIN — ingen förhandsgranskning att skicka.");
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
