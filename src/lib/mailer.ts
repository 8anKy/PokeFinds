/**
 * E-postutskick.
 * EMAIL_MODE=console → loggar mejl till konsolen (dev/demo).
 * RESEND_API_KEY satt → Resends HTTP-API (krävs på hostar som blockerar SMTP-portar, t.ex. Railway).
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

const FROM = process.env.EMAIL_FROM ?? "Foilio <noreply@foilio.se>";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transporter: any | null = null;

function isConsoleMode(): boolean {
  return (
    process.env.EMAIL_MODE === "console" ||
    (!process.env.RESEND_API_KEY && !process.env.SMTP_HOST)
  );
}

async function sendViaResend(input: MailInput): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
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
  if (process.env.RESEND_API_KEY) {
    await sendViaResend(input);
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
