/**
 * E-postutskick via nodemailer.
 * EMAIL_MODE=console → loggar mejl till konsolen (dev/demo).
 * Annars SMTP via env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE.
 */

declare const __non_webpack_require__: typeof require;
const nodeRequire =
  typeof __non_webpack_require__ !== "undefined"
    ? __non_webpack_require__
    : require;

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const FROM = process.env.EMAIL_FROM ?? "PokeFinds <noreply@pokefinds.se>";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transporter: any | null = null;

function isConsoleMode(): boolean {
  return process.env.EMAIL_MODE === "console" || !process.env.SMTP_HOST;
}

function getTransporter() {
  if (transporter) return transporter;
  const nodemailer = nodeRequire("nodemailer");
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

export async function sendMail(input: MailInput): Promise<void> {
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
    return;
  }
  await getTransporter().sendMail({
    from: FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
}
