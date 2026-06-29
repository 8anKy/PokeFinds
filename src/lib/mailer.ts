/**
 * E-postutskick.
 * RESEND_API_KEY satt → Resends HTTP-API. Annars (eller EMAIL_MODE=console) loggas
 * mejlet till konsolen (dev/demo). Railway blockerar SMTP-portar → vi kör ALDRIG SMTP
 * i prod, så nodemailer/SMTP-vägen är borttagen (rensade 6 high-CVE:er).
 */

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const FROM = process.env.EMAIL_FROM ?? "Foilio <noreply@foilio.se>";

function isConsoleMode(): boolean {
  return process.env.EMAIL_MODE === "console" || !process.env.RESEND_API_KEY;
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
  await sendViaResend(input);
}
