/**
 * E-postutskick — TVÅ LEVERANTÖRER, EN FIL, EN ROUTING.
 *
 * - **Resend** (`RESEND_API_KEY`) = transaktionellt: välkomst, lösenord, larm,
 *   Pro-mejl. Gratisnivån tar 100 mejl/dygn.
 * - **Brevo** (`BREVO_API_KEY`) = massutskick (`lane: "bulk"`): veckobrevet och
 *   nyhetsmejlen. Gratisnivån tar 300 mejl/dygn. Finns nyckeln inte faller
 *   bulk-lanen tillbaka på Resend — samma mejl, samma mottagare.
 *
 * VARFÖR (2026-08-30): 92 konton, ~70 med e-post på. Veckobrevet ensamt närmar
 * sig Resends 100/dygn, och den dag ett nyhetsmejl landar samma dag som brevet
 * hade hälften fått `429` — tyst, mitt i loopen. Ett andra Resend-konto var
 * inget alternativ (domänen kan bara DKIM-verifieras en gång per konto-typ, och
 * det är ett kringgående av deras gränser). Två leverantörer med varsin DKIM
 * på foilio.se är rent.
 *
 * ⛔ ETT MEJL GÅR GENOM EXAKT EN LEVERANTÖR. `lane` är ett vägval, aldrig en
 * spridning — ingen mottagare får samma mejl två gånger.
 *
 * Railway blockerar SMTP-portar → vi kör ALDRIG SMTP i prod (HTTP-API hos båda);
 * nodemailer/SMTP-vägen är borttagen (rensade 6 high-CVE:er).
 *
 * ⛔ I PRODUKTION är en saknad nyckel ett FEL, inte konsolläge. Utskicken kastar
 * `MailError` med en dom om felet är permanent, så anroparen kan säga sanningen
 * (registreringen) och köerna slippa studsa mot samma adress tre gånger.
 */

/**
 * Vilken lane mejlet går i. `bulk` = icke-transaktionellt massutskick (ska
 * ALLTID bära `unsubscribeUrl`); allt annat är transaktionellt.
 */
export type MailLane = "transactional" | "bulk";

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Default `transactional` (Resend). `bulk` → Brevo när nyckeln finns. */
  lane?: MailLane;
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
 * `id` = leverantörens meddelande-id, det enda handtaget till om mejlet KOM FRAM.
 * Saknas i konsolläge (inget mejl skickades) — anroparen måste tåla det.
 * `provider` säger vilken pipa det gick genom — det är vad man behöver veta när
 * man letar efter det i rätt konsol.
 */
export interface MailResult {
  id?: string;
  provider?: "resend" | "brevo";
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

// ⛔ `||`, ALDRIG `??`. GitHub Actions expanderar `${{ vars.EMAIL_FROM }}` till TOM
// STRÄNG när repo-variabeln inte finns — och `"" ?? default` är `""`, inte defaulten.
// Avsändaren blev alltså tom och Resend svarade `422 "The domain is invalid"`.
// Upptäckt 2026-08-16 vid första skarpa provutskicket av veckobrevet; felet var
// LATENT i scrape-alls pro-expiry-steg (samma `vars.EMAIL_FROM`), som bara mejlar
// när någon faktiskt håller på att förlora Pro — dvs det hade slagit till först i
// exakt det ögonblick meddelandet betyder något, och tyst, bakom continue-on-error.
// Samma familj som `variantLabel`-vakten 07-28: ett fält som FINNS men är tomt
// passerar en vakt som bara letar efter att det saknas.
const FROM = process.env.EMAIL_FROM || "Foilio <noreply@foilio.se>";
// Avsändaren är noreply@ (DKIM-signerad via Resend på foilio.se). Men användare
// svarar ändå på larmmejlen ("priset har sjunkit" → "har ni kvar den?"). Utan
// reply_to landar svaret på noreply@, som inte finns i Google Workspace → studs
// med "user unknown" och frågan når oss aldrig. Peka svaren på den bemannade lådan.
// `||` av samma skäl som FROM ovan — en tom variabel är inte ett val, den är ett hål.
const REPLY_TO = process.env.EMAIL_REPLY_TO || "hej@foilio.se";

/**
 * Konsolläge är ett UTTRYCKLIGT val (EMAIL_MODE=console) eller utveckling utan
 * nyckel. ⛔ En SAKNAD nyckel i PRODUKTION är INTE konsolläge: då blev varje
 * utskick en tyst lyckad no-op, och registreringen svarade "kolla din inkorg"
 * om ett mejl som aldrig lämnade servern. I prod ska det smälla i stället —
 * se `sendMail` nedan.
 */
function isConsoleMode(): boolean {
  if (process.env.EMAIL_MODE === "console") return true;
  return !process.env.RESEND_API_KEY && !process.env.BREVO_API_KEY && process.env.NODE_ENV !== "production";
}

/**
 * Vägvalet. Bulk går till Brevo när nyckeln finns, allt annat (och bulk utan
 * Brevo-nyckel) till Resend. `null` = ingen leverantör alls är konfigurerad.
 */
export function providerFor(input: Pick<MailInput, "lane">): "brevo" | "resend" | null {
  if (input.lane === "bulk" && process.env.BREVO_API_KEY) return "brevo";
  if (process.env.RESEND_API_KEY) return "resend";
  return null;
}

/** "Foilio <noreply@foilio.se>" → { name, email }. Brevo tar sender som objekt. */
function parseAddress(value: string): { name?: string; email: string } {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(value);
  if (m) return { ...(m[1]?.trim() ? { name: m[1].trim() } : {}), email: m[2].trim() };
  return { email: value.trim() };
}

/** Samma dom för båda leverantörerna: 4xx utom 408/429 = permanent, 5xx = försök igen. */
function permanentStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

async function sendViaBrevo(input: MailInput): Promise<MailResult> {
  let res: Response;
  try {
    res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY ?? "",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: parseAddress(FROM),
        replyTo: parseAddress(REPLY_TO),
        to: [{ email: input.to }],
        subject: input.subject,
        htmlContent: input.html,
        textContent: input.text,
        // Samma två headrar som Resend-vägen — se kommentaren i MailInput.
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
    throw new MailError(`Brevo onåbar: ${String(err)}`, { permanent: false });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new MailError(`Brevo ${res.status}: ${body}`, {
      permanent: permanentStatus(res.status),
      status: res.status,
    });
  }

  // Brevo kvitterar med `messageId`. Ett trasigt svar får ALDRIG fälla ett utskick
  // som redan är kvitterat med 2xx — samma regel som Resend-vägen.
  try {
    const body = (await res.json()) as { messageId?: unknown };
    return {
      id: typeof body.messageId === "string" ? body.messageId : undefined,
      provider: "brevo",
    };
  } catch {
    return { provider: "brevo" };
  }
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
    throw new MailError(`Resend ${res.status}: ${body}`, {
      permanent: permanentStatus(res.status),
      status: res.status,
    });
  }

  // Id:t är frivilligt för anroparen men obligatoriskt för den som vill kunna
  // fråga "kom det fram?". ⛔ Ett trasigt svar får ALDRIG fälla ett utskick som
  // Resend redan kvitterat med 2xx — mejlet ÄR skickat, vi vet bara inte vart
  // vi ska ringa och fråga om det.
  try {
    const body = (await res.json()) as { id?: unknown };
    return { id: typeof body.id === "string" ? body.id : undefined, provider: "resend" };
  } catch {
    return { provider: "resend" };
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
  const provider = providerFor(input);
  if (!provider) {
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
  return provider === "brevo" ? sendViaBrevo(input) : sendViaResend(input);
}
