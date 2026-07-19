/**
 * E-postmallar på svenska. Returnerar {subject, html, text}.
 * Mörkvänlig, enkel inline-stylad HTML med Foilio-branding.
 */

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.foilio.se";

function formatSek(ore: number): string {
  return `${(ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2 })} kr`;
}

/** Gemensamt skal för alla mejl. */
function layout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="sv">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#0f1115;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;padding-bottom:24px;">
      <img src="${APP_URL}/brand/foilio-logo.png" alt="Foilio" width="56" height="56" style="display:inline-block;border:0;width:56px;height:56px;">
    </div>
    <div style="background-color:#1a1d24;border:1px solid #2a2e38;border-radius:12px;padding:32px 28px;color:#e5e7eb;">
      <h1 style="margin:0 0 16px;font-size:20px;color:#ffffff;">${title}</h1>
      ${bodyHtml}
    </div>
    <div style="text-align:center;padding-top:24px;font-size:12px;color:#6b7280;line-height:1.6;">
      Du får detta mejl för att du har ett konto på Foilio.<br>
      Du kan ändra dina aviseringsinställningar i Foilio-appen.<br>
      © Foilio · Sveriges marknadsplats för Pokémon TCG
    </div>
  </div>
</body>
</html>`;
}

function button(url: string, label: string): string {
  return `<div style="text-align:center;margin:24px 0;">
    <a href="${url}" style="display:inline-block;background-color:#fbbf24;color:#111827;text-decoration:none;font-weight:700;padding:12px 28px;border-radius:8px;">${label}</a>
  </div>`;
}

const textFooter =
  "\n\nDu kan ändra dina aviseringsinställningar i Foilio-appen.\nFoilio · Sveriges marknadsplats för Pokémon TCG";

export function welcomeEmail(name: string): EmailContent {
  const subject = "Välkommen till Foilio!";
  const html = layout(
    `Välkommen, ${name}!`,
    `<p style="line-height:1.6;color:#cbd5e1;">Kul att ha dig här! Med Foilio kan du jämföra priser på Pokémon TCG-produkter, bevaka dina favoriter och få aviseringar när priser sjunker eller produkter kommer tillbaka i lager.</p>
     <p style="line-height:1.6;color:#cbd5e1;">Öppna Foilio-appen och lägg till produkter i din bevakningslista för att komma igång.</p>`
  );
  const text = `Välkommen, ${name}!\n\nKul att ha dig här! Med Foilio kan du jämföra priser, bevaka produkter och få aviseringar vid prisfall och restocks.\n\nÖppna Foilio-appen för att komma igång.${textFooter}`;
  return { subject, html, text };
}

export function verifyEmail(name: string, verifyUrl: string): EmailContent {
  const subject = "Bekräfta din e-postadress – Foilio";
  const html = layout(
    "Bekräfta din e-postadress",
    `<p style="line-height:1.6;color:#cbd5e1;">Hej ${name}! Klicka på knappen nedan för att bekräfta din e-postadress och aktivera ditt konto.</p>
     ${button(verifyUrl, "Bekräfta e-postadress")}
     <p style="line-height:1.6;color:#6b7280;font-size:13px;">Om du inte skapade ett konto kan du ignorera detta mejl.</p>`
  );
  const text = `Hej ${name}!\n\nBekräfta din e-postadress genom att öppna länken:\n${verifyUrl}\n\nOm du inte skapade ett konto kan du ignorera detta mejl.${textFooter}`;
  return { subject, html, text };
}

/** Referral-belöning (#10): 3 vänner verifierade → 1 månad Pro. */
export function proRewardEmail(name: string, until: Date): EmailContent {
  const untilStr = until.toLocaleDateString("sv-SE", { year: "numeric", month: "long", day: "numeric" });
  const subject = "Du har fått 1 månad Pro · Foilio";
  const html = layout(
    "Grattis, du har fått Pro!",
    `<p style="line-height:1.6;color:#cbd5e1;">Hej ${name}! Tre av dina inbjudna vänner har nu bekräftat sina konton. Som tack får du en månad Foilio Pro, aktiv till och med <strong style="color:#ffffff;">${untilStr}</strong>.</p>
     <p style="line-height:1.6;color:#cbd5e1;">Pro ger dig prisbevakning med larm, restock-aviseringar och fler skanningar. Mycket nöje!</p>
     ${button(`${APP_URL}/bevakningar`, "Kom igång med dina larm")}`
  );
  const text = `Hej ${name}!\n\nTre av dina inbjudna vänner har bekräftat sina konton. Som tack får du en månad Foilio Pro, aktiv till och med ${untilStr}.\n\nPro ger dig prisbevakning med larm, restock-aviseringar och fler skanningar: ${APP_URL}/bevakningar${textFooter}`;
  return { subject, html, text };
}

export function priceAlertEmail(
  name: string,
  productTitle: string,
  price: number,
  url: string
): EmailContent {
  const subject = `Prisfall: ${productTitle} – nu ${formatSek(price)}`;
  const html = layout(
    "Prisfall på en bevakad produkt!",
    `<p style="line-height:1.6;color:#cbd5e1;">Hej ${name}! En produkt i din bevakningslista har sjunkit i pris:</p>
     <p style="font-size:16px;font-weight:700;color:#ffffff;margin:16px 0 4px;">${productTitle}</p>
     <p style="font-size:22px;font-weight:800;color:#34d399;margin:0 0 8px;">${formatSek(price)}</p>
     ${button(url, "Se erbjudandet")}`
  );
  const text = `Hej ${name}!\n\nPrisfall på en bevakad produkt:\n${productTitle}\nNytt pris: ${formatSek(price)}\n\nSe erbjudandet: ${url}${textFooter}`;
  return { subject, html, text };
}

export function restockAlertEmail(
  name: string,
  productTitle: string,
  retailerName: string,
  url: string,
  price?: number
): EmailContent {
  const subject = `Åter i lager: ${productTitle} hos ${retailerName}`;
  const priceLine = price
    ? `<p style="font-size:22px;font-weight:800;color:#34d399;margin:0 0 8px;">${formatSek(price)}</p>`
    : "";
  const html = layout(
    "Åter i lager!",
    `<p style="line-height:1.6;color:#cbd5e1;">Hej ${name}! En produkt du bevakar finns nu i lager igen:</p>
     <p style="font-size:16px;font-weight:700;color:#ffffff;margin:16px 0 4px;">${productTitle}</p>
     ${priceLine}
     <p style="color:#cbd5e1;margin:0 0 8px;">Hos: <strong style="color:#2dd4bf;">${retailerName}</strong></p>
     <p style="line-height:1.6;color:#fbbf24;font-size:13px;">Populära produkter säljer ofta slut snabbt. Skynda dig!</p>
     ${button(url, "Köp nu")}`
  );
  const text = `Hej ${name}!\n\nÅter i lager: ${productTitle}${price ? `\nPris: ${formatSek(price)}` : ""}\nHos: ${retailerName}\n\nKöp nu: ${url}\n\nPopulära produkter säljer ofta slut snabbt!${textFooter}`;
  return { subject, html, text };
}

export function newListingEmail(
  name: string,
  productTitle: string,
  retailerName: string,
  url: string,
  price?: number
): EmailContent {
  const subject = `Ny produkt i lager: ${productTitle} hos ${retailerName}`;
  const priceLine = price
    ? `<p style="font-size:22px;font-weight:800;color:#34d399;margin:0 0 8px;">${formatSek(price)}</p>`
    : "";
  const html = layout(
    "Ny produkt i lager! 🎉",
    `<p style="line-height:1.6;color:#cbd5e1;">Hej ${name}! En ny produkt har precis dykt upp i lager:</p>
     <p style="font-size:16px;font-weight:700;color:#ffffff;margin:16px 0 4px;">${productTitle}</p>
     ${priceLine}
     <p style="color:#cbd5e1;margin:0 0 8px;">Hos: <strong style="color:#2dd4bf;">${retailerName}</strong></p>
     <p style="line-height:1.6;color:#fbbf24;font-size:13px;">Nya produkter säljer ofta slut snabbt. Skynda dig!</p>
     ${button(url, "Till produkten")}`
  );
  const text = `Hej ${name}!\n\nNy produkt i lager: ${productTitle}${price ? `\nPris: ${formatSek(price)}` : ""}\nHos: ${retailerName}\n\nTill produkten: ${url}${textFooter}`;
  return { subject, html, text };
}

export function preorderEmail(
  name: string,
  productTitle: string,
  retailerName: string,
  url: string,
  price?: number
): EmailContent {
  const subject = `Förhandsboka nu: ${productTitle} hos ${retailerName}`;
  const priceLine = price
    ? `<p style="font-size:22px;font-weight:800;color:#34d399;margin:0 0 8px;">${formatSek(price)}</p>`
    : "";
  const html = layout(
    "Öppen för förhandsbokning! 📦",
    `<p style="line-height:1.6;color:#cbd5e1;">Hej ${name}! En produkt går nu att förhandsboka:</p>
     <p style="font-size:16px;font-weight:700;color:#ffffff;margin:16px 0 4px;">${productTitle}</p>
     ${priceLine}
     <p style="color:#cbd5e1;margin:0 0 8px;">Hos: <strong style="color:#2dd4bf;">${retailerName}</strong></p>
     <p style="line-height:1.6;color:#fbbf24;font-size:13px;">Förhandsbokningar tar ofta slut innan release. Säkra din nu.</p>
     ${button(url, "Förhandsboka hos " + retailerName)}`
  );
  const text = `Hej ${name}!\n\nÖppen för förhandsbokning: ${productTitle}${price ? `\nPris: ${formatSek(price)}` : ""}\nHos: ${retailerName}\n\nFörhandsboka: ${url}\n\nFörhandsbokningar tar ofta slut innan release!${textFooter}`;
  return { subject, html, text };
}

export function passwordResetEmail(name: string, resetUrl: string): EmailContent {
  const subject = "Återställ ditt lösenord – Foilio";
  const html = layout(
    "Återställ ditt lösenord",
    `<p style="line-height:1.6;color:#cbd5e1;">Hej ${name}! Vi fick en begäran om att återställa ditt lösenord. Klicka på knappen nedan för att välja ett nytt. Länken är giltig i 1 timme.</p>
     ${button(resetUrl, "Återställ lösenord")}
     <p style="line-height:1.6;color:#6b7280;font-size:13px;">Om du inte begärde detta kan du ignorera mejlet. Ditt lösenord förblir oförändrat.</p>`
  );
  const text = `Hej ${name}!\n\nÅterställ ditt lösenord via länken (giltig i 1 timme):\n${resetUrl}\n\nOm du inte begärde detta kan du ignorera mejlet.${textFooter}`;
  return { subject, html, text };
}
