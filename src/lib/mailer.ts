/**
 * E-postutskick.
 * RESEND_API_KEY satt → Resends HTTP-API. Annars (eller EMAIL_MODE=console) loggas
 * mejlet till konsolen (dev/demo). Railway blockerar SMTP-portar → vi kör ALDRIG SMTP
 * i prod, så nodemailer/SMTP-vägen är borttagen (rensade 6 high-CVE:er).
 *
 * ⛔ I PRODUKTION är en saknad nyckel ett FEL, inte konsolläge. Utskicken kastar
 * `MailError` med en dom om felet är permanent, så anroparen kan säga sanningen
 * (registreringen) och köerna slippa studsa mot samma adress tre gånger.
 */

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Avregistreringslänk för ICKE-transaktionella utskick (veckobrevet).
   *
   * ⛔ SÄTTS BARA PÅ MASSUTSKICK. Ett `List-Unsubscribe` på ett lösenords-
   * återställningsmejl erbjuder mottagaren att avanmäla sig från något hen inte
   * prenumererar på, och gör headern meningslös där den betyder något.
   *
   * Finns den byggs BÅDA headrarna (`List-Unsubscribe` +
   * `List-Unsubscribe-Post`) här — RFC 8058 kräver att URL:en tar en POST, och
   * en av dem utan den andra ger Gmail/Outlook ingen ett-klicks-knapp alls.
   * Att bygga dem på ETT ställe är hela poängen: två anropare hade formaterat
   * vinkelparenteserna olika och den ena hade tyst tappat knappen.
   */
  unsubscribeUrl?: string;
}

/**
 * `id` = Resends meddelande-id, det enda handtaget till om mejlet KOM FRAM.
 * Saknas i konsolläge (inget mejl skickades) — anroparen måste tåla det.
 */
export interface MailResult {
  id?: string;
}

/**
 * Fel från ett utskick, med en DOM om det är lönt att försöka igen.
 * `permanent` = mottagaren eller innehållet är fel och blir aldrig rätt av ett
 * omförsök. Varje sådant omförsök är ännu en hård studs mot foilio.se:s
 * avsändarrykte — därför slutar `dispatchPendingAlerts` genast på permanenta fel.
 */
export class MailError extends Error {
  readonly permanent: boolean;
  readonly status?: number;

  constructor(message: string, opts: { permanent: boolean; status?: number }) {
    super(message);
    this.name = "MailError";
    this.permanent = opts.permanent;
    this.status = opts.status;
  }
}

/** Ska det här felet INTE försökas igen? Okända fel räknas som övergående. */
export function isPermanentMailError(err: unknown): boolean {
  return err instanceof MailError && err.permanent;
}

const FROM = process.env.EMAIL_FROM ?? "Foilio <noreply@foilio.se>";
// Avsändaren är noreply@ (DKIM-signerad via Resend på foilio.se). Men användare
// svarar ändå på larmmejlen ("priset har sjunkit" → "har ni kvar den?"). Utan
// reply_to landar svaret på noreply@, som inte finns i Google Workspace → studs
// med "user unknown" och frågan når oss aldrig. Peka svaren på den bemannade lådan.
const REPLY_TO = process.env.EMAIL_REPLY_TO ?? "hej@foilio.se";

/**
 * Konsolläge är ett UTTRYCKLIGT val (EMAIL_MODE=console) eller utveckling utan
 * nyckel. ⛔ En SAKNAD nyckel i PRODUKTION är INTE konsolläge: då blev varje
 * utskick en tyst lyckad no-op, och registreringen svarade "kolla din inkorg"
 * om ett mejl som aldrig lämnade servern. I prod ska det smälla i stället —
 * se `sendMail` nedan.
 */
function isConsoleMode(): boolean {
  if (process.env.EMAIL_MODE === "console") return true;
  return !process.env.RESEND_API_KEY && process.env.NODE_ENV !== "production";
}

async function sendViaResend(input: MailInput): Promise<MailResult> {
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        reply_to: REPLY_TO,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        // Ett-klicks-avanmälan (RFC 8058). Gmail och Outlook visar då sin egen
        // "Avsluta prenumeration"-knapp bredvid avsändaren och POST:ar till
        // URL:en — mottagaren behöver aldrig öppna mejlet. Utan headern är
        // spamknappen enda vägen ut, och den kostar avsändarryktet.
        ...(input.unsubscribeUrl
          ? {
              headers: {
                "List-Unsubscribe": `<${input.unsubscribeUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            }
          : {}),
      }),
    });
  } catch (err) {
    // Nätverksfel (DNS, timeout, Resend nere) → övergående, försök igen senare.
    throw new MailError(`Resend onåbar: ${String(err)}`, { permanent: false });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 4xx = VÅR begäran är fel (ogiltig mottagare, avvisad/ej verifierad domän,
    // trasig payload) och blir inte rätt av ett omförsök. Undantagen är 408 och
    // 429 — de säger "för snabbt", inte "fel". 5xx = Resends problem → försök igen.
    const permanent =
      res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
    throw new MailError(`Resend ${res.status}: ${body}`, { permanent, status: res.status });
  }

  // Id:t är frivilligt för anroparen men obligatoriskt för den som vill kunna
  // fråga "kom det fram?". ⛔ Ett trasigt svar får ALDRIG fälla ett utskick som
  // Resend redan kvitterat med 2xx — mejlet ÄR skickat, vi vet bara inte vart
  // vi ska ringa och fråga om det.
  try {
    const body = (await res.json()) as { id?: unknown };
    return { id: typeof body.id === "string" ? body.id : undefined };
  } catch {
    return {};
  }
}

export async function sendMail(input: MailInput): Promise<MailResult> {
  if (isConsoleMode()) {
    console.log(
      [
        "────────────────────────────────────────",
        "[mailer] EMAIL_MODE=console — mejl loggas i stället för att skickas",
        `Till:    ${input.to}`,
        `Ämne:    ${input.subject}`,
        "",
        input.text,
        "────────────────────────────────────────",
      ].join("\n")
    );
    return {};
  }
  if (!process.env.RESEND_API_KEY) {
    // Prod utan nyckel: skrik. Ett tyst "skickat" är värre än ett fel — då tror
    // både användaren och koden att mejlet är på väg. Övergående, inte permanent:
    // felet ligger i konfigurationen och lagas genom att nyckeln sätts.
    console.error(
      `[mailer] RESEND_API_KEY saknas i produktion — utskicket till ${input.to} ("${input.subject}") gick ALDRIG iväg.`
    );
    throw new MailError("RESEND_API_KEY saknas i produktion — inga mejl kan skickas.", {
      permanent: false,
    });
  }
  return sendViaResend(input);
}
