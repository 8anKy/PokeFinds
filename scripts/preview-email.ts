/**
 * Renderar en e-postmall till en HTML-fil och öppnar den i webbläsaren.
 * Rör varken databasen eller Resend — ren förhandsvisning.
 *
 * Kör: npx tsx scripts/preview-email.ts [mall]
 * Mallar: discord-invite (default), welcome, pro-expiring, restock
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  discordInviteEmail,
  welcomeEmail,
  proExpiringEmail,
  restockAlertEmail,
  type EmailContent,
} from "@/emails/templates";

const NAME = "Milos";

const TEMPLATES: Record<string, () => EmailContent> = {
  "discord-invite": () => discordInviteEmail(NAME),
  welcome: () => welcomeEmail(NAME),
  "pro-expiring": () => proExpiringEmail(NAME, new Date(Date.now() + 3 * 864e5), 3),
  restock: () =>
    restockAlertEmail(
      NAME,
      "Prismatic Evolutions Elite Trainer Box",
      "Dragon's Lair",
      "https://foilio.se",
      89900
    ),
};

const key = process.argv[2] ?? "discord-invite";
const make = TEMPLATES[key];
if (!make) {
  console.error(`Okänd mall "${key}". Välj: ${Object.keys(TEMPLATES).join(", ")}`);
  process.exit(1);
}

const mail = make();
// Wrappern visar ämnesrad + textversion ovanför själva mejlet: en mottagare ser
// ämnet först, och textversionen är det som faktiskt visas i klienter som blockar
// HTML. Mejlet självt ligger i en iframe så dess CSS inte blandas med wrapperns.
const page = `<!DOCTYPE html><html lang="sv"><head><meta charset="utf-8"><title>${mail.subject}</title></head>
<body style="margin:0;background:#111;font-family:'Segoe UI',Arial,sans-serif;color:#ddd;">
  <div style="max-width:760px;margin:0 auto;padding:24px 16px;">
    <p style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#888;margin:0 0 4px;">Ämnesrad</p>
    <p style="font-size:18px;font-weight:700;color:#fff;margin:0 0 24px;">${mail.subject}</p>
    <p style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#888;margin:0 0 8px;">HTML-version</p>
    <iframe srcdoc="${mail.html.replace(/"/g, "&quot;")}" style="width:100%;height:900px;border:1px solid #333;border-radius:8px;background:#0f1115;"></iframe>
    <p style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#888;margin:32px 0 8px;">Textversion (klienter utan HTML)</p>
    <pre style="white-space:pre-wrap;background:#000;border:1px solid #333;border-radius:8px;padding:16px;font-size:13px;line-height:1.6;color:#bbb;">${mail.text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")}</pre>
  </div>
</body></html>`;

const out = join(tmpdir(), `foilio-email-${key}.html`);
writeFileSync(out, page, "utf8");
console.log(`Förhandsvisning: ${out}`);
spawn("cmd", ["/c", "start", "", out], { detached: true, stdio: "ignore" }).unref();
