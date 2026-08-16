/**
 * E-postmallar på svenska. Returnerar {subject, html, text}.
 * Mörkvänlig, enkel inline-stylad HTML med Foilio-branding.
 */

// ⛔ Bara rena konstanter får importeras hit: templates.ts når EDGE-bundlen via
// instrumentation → scheduler → notifications, där Node-API:er (t.ex. 'crypto')
// inte finns. social-links.ts är enbart strängar — se signup-code-noten nedan.
import { DISCORD_URL } from "@/lib/social-links";

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

// ⛔ APEX, aldrig www: apex är kanonisk sedan 2026-08-14 och www 301:as av
// Cloudflare. En webbläsare följer den redirecten, men reservvärdet ska ändå peka
// rätt — samma regel som för alla maskinella URL:er.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://foilio.se";

function formatSek(ore: number): string {
  return `${(ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2 })} kr`;
}

/**
 * Gemensamt skal för alla mejl. `footerReason` finns för mejl till adresser
 * UTAN konto (registreringskoden) — standardraden "du har ett konto" vore
 * då osann, och mottagaren kan vara någon vars adress en främling knappade in.
 */
function layout(
  title: string,
  bodyHtml: string,
  footerReason = "Du får detta mejl för att du har ett konto på Foilio.<br>Du kan ändra dina aviseringsinställningar i Foilio-appen."
): string {
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
      ${footerReason}<br>
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

/**
 * "Varför får jag det här?" — raden som gör ett set-bevakningslarm begripligt.
 *
 * En set-bevakning larmar om varor användaren aldrig rört, och utan skälet läser
 * mejlet som om vi mejlar slumpvis. Utelämnas när skälet är uppenbart (egen
 * produktbevakning) → tomma strängar, ingen tom rad i mallen.
 */
function setWatchReason(setName?: string | null): { html: string; text: string } {
  if (!setName) return { html: "", text: "" };
  return {
    html: `<p style="line-height:1.6;color:#6b7280;font-size:13px;margin:16px 0 0;">Du får det här mejlet för att du bevakar sealed-produkter i <strong style="color:#cbd5e1;">${setName}</strong>.</p>`,
    text: `\n\nDu får det här mejlet för att du bevakar sealed-produkter i ${setName}.`,
  };
}

/**
 * Välkomstmejlet bär också Discord-inbjudan (2026-08-14). Det är den DURABLA
 * versionen av engångsutskicket: varje nytt konto blir bjudet automatiskt, i
 * stället för att någon måste komma ihåg att köra ett skript igen.
 *
 * ⛔ Inbjudan står SIST och som en egen ruta — välkomstmejlets uppgift är att få
 * folk att komma igång i appen, och en Discord-knapp högst upp hade konkurrerat
 * med precis det. Nämner inte kontokoppling: `DISCORD_ENABLED=false`.
 */
export function welcomeEmail(name: string): EmailContent {
  const subject = "Välkommen till Foilio!";
  const html = layout(
    `Välkommen, ${name}!`,
    `<p style="line-height:1.6;color:#cbd5e1;">Kul att ha dig här! Med Foilio kan du jämföra priser på Pokémon TCG-produkter, bevaka dina favoriter och få aviseringar när priser sjunker eller produkter kommer tillbaka i lager.</p>
     <p style="line-height:1.6;color:#cbd5e1;">Öppna Foilio-appen och lägg till produkter i din bevakningslista för att komma igång.</p>
     <div style="margin:28px 0 0;padding:20px;background-color:#0f1115;border:1px solid #2a2e38;border-radius:10px;">
       <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#ffffff;">Häng med oss på Discord 👋</p>
       <p style="margin:0;line-height:1.6;color:#cbd5e1;font-size:14px;">Restocks postas direkt i egna kanaler per serie, och du kan fråga andra samlare om priser och fynd. Gratis och öppet för alla.</p>
       <p style="margin:16px 0 0;">
         <a href="${DISCORD_URL}" style="display:inline-block;background-color:#2dd4bf;color:#08110f;text-decoration:none;font-weight:700;padding:10px 22px;border-radius:8px;font-size:14px;">Gå med i Discord</a>
       </p>
     </div>`
  );
  const text = `Välkommen, ${name}!\n\nKul att ha dig här! Med Foilio kan du jämföra priser, bevaka produkter och få aviseringar vid prisfall och restocks.\n\nÖppna Foilio-appen för att komma igång.\n\n— Häng med oss på Discord —\nRestocks postas direkt i egna kanaler per serie, och du kan fråga andra samlare om priser och fynd. Gratis och öppet för alla.\nGå med: ${DISCORD_URL}${textFooter}`;
  return { subject, html, text };
}

/**
 * Registreringskoden ("Skicka kod"-steget). Mottagaren har inget konto ännu,
 * och kan vara någon vars adress en främling knappade in — därav footern och
 * ignorera-raden. `ttlMs` skickas in av anroparen (SIGNUP_CODE_TTL_MS) så copy
 * och kod inte kan glida isär — ⛔ modulen får inte importera signup-code
 * själv: den drar in Node-crypto, och templates.ts når edge-bundlen via
 * instrumentation → scheduler → notifications, där 'crypto' inte finns.
 */
export function signupCodeEmail(code: string, ttlMs: number): EmailContent {
  const minutes = Math.round(ttlMs / 60_000);
  const subject = "Din verifieringskod – Foilio";
  const footerReason = "Du får detta mejl för att din adress angavs vid registrering på Foilio.";
  const html = layout(
    "Bekräfta din e-postadress",
    `<p style="line-height:1.6;color:#cbd5e1;">Ange koden nedan för att slutföra registreringen av ditt Foilio-konto.</p>
     <div style="text-align:center;margin:24px 0;">
       <span style="display:inline-block;background-color:#0f1115;border:1px solid #2a2e38;border-radius:8px;padding:14px 24px;font-size:28px;font-weight:700;letter-spacing:8px;color:#ffffff;">${code}</span>
     </div>
     <p style="line-height:1.6;color:#cbd5e1;">Koden gäller i ${minutes} minuter.</p>
     <p style="line-height:1.6;color:#6b7280;font-size:13px;">Försökte du inte skapa ett konto? Då kan du ignorera detta mejl — inget konto skapas utan koden.</p>`,
    footerReason
  );
  const text = `Din verifieringskod för att skapa ett Foilio-konto: ${code}\n\nKoden gäller i ${minutes} minuter.\n\nFörsökte du inte skapa ett konto? Då kan du ignorera detta mejl — inget konto skapas utan koden.\n\nFoilio · Sveriges marknadsplats för Pokémon TCG`;
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

/**
 * Varning några dagar innan en gratis Pro-period tar slut.
 *
 * ⛔ DEN HÄR FÅR INTE UTEBLI. Restock-larm är Pro-only, så när perioden löper ut
 * SLUTAR larmen tyst — och en användare som inte fått veta varför drar slutsatsen
 * att Foilio är trasigt, inte att provperioden tog slut. Exakt det tysta bortfallet
 * har redan hänt en gång (RevenueCat-EXPIRATION 2026-07-08, fyra dygn utan larm).
 */
export function proExpiringEmail(name: string, until: Date, daysLeft: number): EmailContent {
  const untilStr = until.toLocaleDateString("sv-SE", { year: "numeric", month: "long", day: "numeric" });
  const dayWord = daysLeft === 1 ? "i morgon" : `om ${daysLeft} dagar`;
  const subject = `Din gratisperiod med Pro tar slut ${dayWord} · Foilio`;
  const html = layout(
    "Din Pro-period närmar sig slutet",
    `<p style="line-height:1.6;color:#cbd5e1;">Hej ${name}! Din gratisperiod med Foilio Pro gäller till och med <strong style="color:#ffffff;">${untilStr}</strong>.</p>
     <p style="line-height:1.6;color:#cbd5e1;">Efter det pausas dina <strong style="color:#ffffff;">restock-larm</strong> och du går tillbaka till gratisplanens gränser. Dina bevakningar och din samling ligger kvar — du behöver inte göra någonting för att spara dem.</p>
     <p style="line-height:1.6;color:#cbd5e1;">Vill du behålla larmen kostar Pro 49 kr i månaden och kan sägas upp när som helst.</p>
     ${button(`${APP_URL}/priser`, "Fortsätt med Pro")}`
  );
  const text = `Hej ${name}!\n\nDin gratisperiod med Foilio Pro gäller till och med ${untilStr}.\n\nEfter det pausas dina restock-larm och du går tillbaka till gratisplanens gränser. Dina bevakningar och din samling ligger kvar.\n\nVill du behålla larmen kostar Pro 49 kr i månaden och kan sägas upp när som helst: ${APP_URL}/priser${textFooter}`;
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
  price?: number,
  reasonSetName?: string | null
): EmailContent {
  const subject = `Åter i lager: ${productTitle} hos ${retailerName}`;
  const priceLine = price
    ? `<p style="font-size:22px;font-weight:800;color:#34d399;margin:0 0 8px;">${formatSek(price)}</p>`
    : "";
  const reason = setWatchReason(reasonSetName);
  const html = layout(
    "Åter i lager!",
    `<p style="line-height:1.6;color:#cbd5e1;">Hej ${name}! En produkt du bevakar finns nu i lager igen:</p>
     <p style="font-size:16px;font-weight:700;color:#ffffff;margin:16px 0 4px;">${productTitle}</p>
     ${priceLine}
     <p style="color:#cbd5e1;margin:0 0 8px;">Hos: <strong style="color:#2dd4bf;">${retailerName}</strong></p>
     <p style="line-height:1.6;color:#fbbf24;font-size:13px;">Populära produkter säljer ofta slut snabbt. Skynda dig!</p>
     ${button(url, "Köp nu")}
     ${reason.html}`
  );
  const text = `Hej ${name}!\n\nÅter i lager: ${productTitle}${price ? `\nPris: ${formatSek(price)}` : ""}\nHos: ${retailerName}\n\nKöp nu: ${url}\n\nPopulära produkter säljer ofta slut snabbt!${reason.text}${textFooter}`;
  return { subject, html, text };
}

/**
 * SLÄPPET: en produkt som gått från förhandsbokning till riktigt lager. Skild från
 * restockAlertEmail med flit — "Åter i lager … finns nu i lager igen" är falskt för
 * något som aldrig varit i lager, och släppet är det larm bevakaren väntat längst på.
 */
export function releasedEmail(
  name: string,
  productTitle: string,
  retailerName: string,
  url: string,
  price?: number,
  reasonSetName?: string | null
): EmailContent {
  const subject = `Nu släppt: ${productTitle} hos ${retailerName}`;
  const priceLine = price
    ? `<p style="font-size:22px;font-weight:800;color:#34d399;margin:0 0 8px;">${formatSek(price)}</p>`
    : "";
  const reason = setWatchReason(reasonSetName);
  const html = layout(
    "Förhandsbokningen är släppt! 🎉",
    `<p style="line-height:1.6;color:#cbd5e1;">Hej ${name}! En produkt du bevakar har gått från förhandsbokning till riktigt lager — den skickas nu:</p>
     <p style="font-size:16px;font-weight:700;color:#ffffff;margin:16px 0 4px;">${productTitle}</p>
     ${priceLine}
     <p style="color:#cbd5e1;margin:0 0 8px;">Hos: <strong style="color:#2dd4bf;">${retailerName}</strong></p>
     <p style="line-height:1.6;color:#fbbf24;font-size:13px;">Releasedagar tar slut snabbast av alla. Skynda dig!</p>
     ${button(url, "Köp nu")}
     ${reason.html}`
  );
  const text = `Hej ${name}!\n\nNu släppt: ${productTitle}${price ? `\nPris: ${formatSek(price)}` : ""}\nHos: ${retailerName}\n\nProdukten har gått från förhandsbokning till riktigt lager och skickas nu.\n\nKöp nu: ${url}\n\nReleasedagar tar slut snabbast av alla!${reason.text}${textFooter}`;
  return { subject, html, text };
}

export function newListingEmail(
  name: string,
  productTitle: string,
  retailerName: string,
  url: string,
  price?: number,
  reasonSetName?: string | null
): EmailContent {
  const subject = `Ny produkt i lager: ${productTitle} hos ${retailerName}`;
  const priceLine = price
    ? `<p style="font-size:22px;font-weight:800;color:#34d399;margin:0 0 8px;">${formatSek(price)}</p>`
    : "";
  const reason = setWatchReason(reasonSetName);
  const html = layout(
    "Ny produkt i lager! 🎉",
    `<p style="line-height:1.6;color:#cbd5e1;">Hej ${name}! En ny produkt har precis dykt upp i lager:</p>
     <p style="font-size:16px;font-weight:700;color:#ffffff;margin:16px 0 4px;">${productTitle}</p>
     ${priceLine}
     <p style="color:#cbd5e1;margin:0 0 8px;">Hos: <strong style="color:#2dd4bf;">${retailerName}</strong></p>
     <p style="line-height:1.6;color:#fbbf24;font-size:13px;">Nya produkter säljer ofta slut snabbt. Skynda dig!</p>
     ${button(url, "Till produkten")}
     ${reason.html}`
  );
  const text = `Hej ${name}!\n\nNy produkt i lager: ${productTitle}${price ? `\nPris: ${formatSek(price)}` : ""}\nHos: ${retailerName}\n\nTill produkten: ${url}${reason.text}${textFooter}`;
  return { subject, html, text };
}

export function preorderEmail(
  name: string,
  productTitle: string,
  retailerName: string,
  url: string,
  price?: number,
  reasonSetName?: string | null
): EmailContent {
  const subject = `Förhandsboka nu: ${productTitle} hos ${retailerName}`;
  const priceLine = price
    ? `<p style="font-size:22px;font-weight:800;color:#34d399;margin:0 0 8px;">${formatSek(price)}</p>`
    : "";
  const reason = setWatchReason(reasonSetName);
  const html = layout(
    "Öppen för förhandsbokning! 📦",
    `<p style="line-height:1.6;color:#cbd5e1;">Hej ${name}! En produkt går nu att förhandsboka:</p>
     <p style="font-size:16px;font-weight:700;color:#ffffff;margin:16px 0 4px;">${productTitle}</p>
     ${priceLine}
     <p style="color:#cbd5e1;margin:0 0 8px;">Hos: <strong style="color:#2dd4bf;">${retailerName}</strong></p>
     <p style="line-height:1.6;color:#fbbf24;font-size:13px;">Förhandsbokningar tar ofta slut innan release. Säkra din nu.</p>
     ${button(url, "Förhandsboka hos " + retailerName)}
     ${reason.html}`
  );
  const text = `Hej ${name}!\n\nÖppen för förhandsbokning: ${productTitle}${price ? `\nPris: ${formatSek(price)}` : ""}\nHos: ${retailerName}\n\nFörhandsboka: ${url}\n\nFörhandsbokningar tar ofta slut innan release!${reason.text}${textFooter}`;
  return { subject, html, text };
}

/**
 * INBJUDAN TILL DISCORD — ett engångsutskick till befintliga konton, inte ett larm.
 *
 * ⛔ Nämner INTE kontokoppling eller roller: `DISCORD_ENABLED=false` tills
 * integritetspolicyn är juristgranskad, så knappen i /installningar finns inte.
 * Mejlet leder till den PUBLIKA inbjudan, som fungerar oavsett — går servern och
 * kontot ihop senare är det en egen nyhet.
 *
 * ⛔ Footern måste peka på avanmälan: det här är inget transaktionsmejl, och
 * `notificationSettings.email` är den enda spak mottagaren har.
 */
export function discordInviteEmail(name: string): EmailContent {
  const subject = "Foilio finns på Discord – restocks direkt i mobilen";
  const footerReason =
    "Du får detta mejl för att du har ett konto på Foilio. Det här är ett engångsutskick om vår community.<br>Vill du inte ha mejl från oss stänger du av e-post under Inställningar i Foilio-appen.";
  const html = layout(
    "Kom och häng med oss på Discord 👋",
    `<p style="line-height:1.6;color:#cbd5e1;">Hej ${name}! Vi har öppnat en Discord-server för svenska Pokémon-samlare – och du är varmt välkommen in.</p>
     <p style="line-height:1.6;color:#cbd5e1;margin:20px 0 8px;font-weight:600;color:#ffffff;">Vad du får där:</p>
     <ul style="line-height:1.7;color:#cbd5e1;padding-left:20px;margin:0;">
       <li><strong style="color:#ffffff;">Restocks postas direkt</strong> – egna kanaler per serie, så du slipper bruset från set du inte samlar på.</li>
       <li><strong style="color:#ffffff;">Fråga om priser och fynd</strong> – är 900 kr rimligt för lådan? Fråga folk som köper dem varje vecka.</li>
       <li><strong style="color:#ffffff;">Påverka vad vi bygger</strong> – saknas din butik i Foilio? Säg till, så står den ofta på listan samma vecka.</li>
     </ul>
     ${button(DISCORD_URL, "Gå med i Discord")}
     <p style="line-height:1.6;color:#6b7280;font-size:13px;">Servern är gratis och öppen för alla. Du behöver inte koppla ditt Foilio-konto – det räcker med att klicka.</p>`,
    footerReason
  );
  const text = `Hej ${name}!

Vi har öppnat en Discord-server för svenska Pokémon-samlare – och du är varmt välkommen in.

Vad du får där:
· Restocks postas direkt – egna kanaler per serie, så du slipper bruset från set du inte samlar på.
· Fråga om priser och fynd – är 900 kr rimligt för lådan? Fråga folk som köper dem varje vecka.
· Påverka vad vi bygger – saknas din butik i Foilio? Säg till, så står den ofta på listan samma vecka.

Gå med här: ${DISCORD_URL}

Servern är gratis och öppen för alla. Du behöver inte koppla ditt Foilio-konto – det räcker med att klicka.

Du får detta mejl för att du har ett konto på Foilio. Det här är ett engångsutskick om vår community. Vill du inte ha mejl från oss stänger du av e-post under Inställningar i Foilio-appen.
Foilio · Sveriges marknadsplats för Pokémon TCG`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// VECKOBREVET
// ---------------------------------------------------------------------------

/** Ett kort i samlingen som rört sig mest på sju dagar. */
export interface DigestMover {
  name: string;
  setName: string | null;
  percent: number;
  valueOre: number | null;
}

/** Prisfall på en produkt användaren bevakar. `percent` är NEGATIV. */
export interface DigestDrop {
  title: string;
  url: string;
  priceOre: number | null;
  percent: number;
}

/** Restock i ett bevakat set eller på en bevakad produkt. */
export interface DigestRestock {
  title: string;
  url: string;
  retailerName: string;
  priceOre: number | null;
}

/** Ett butiksfynd under Cardmarket-pris. `percentUnder` är POSITIV. */
export interface DigestDealExample {
  title: string;
  url: string;
  retailerName: string;
  priceOre: number;
  percentUnder: number;
}

export interface WeeklyDigestContent {
  name: string;
  /** Signerad avanmälan (src/lib/unsubscribe-token.ts). Obligatorisk — se sidfoten. */
  unsubscribeUrl: string;
  /** Utelämnas helt för den som inte har någon samling. */
  collection?: {
    totalValueOre: number;
    /** null = vi har inte sju dygns kurva ännu. Då visas ingen förändring alls. */
    changeOre: number | null;
    changePercent: number | null;
    movers: DigestMover[];
  };
  drops: DigestDrop[];
  restocks: DigestRestock[];
  pulse: {
    underMarketCount: number;
    /** Tröskeln bandet räknades med — copyn får ALDRIG påstå en annan siffra. */
    minDiscountPercent: number;
    examples: DigestDealExample[];
    restockCount: number;
    newSetCount: number;
  };
}

/** "+3,2 %" / "−1,8 %". Minustecknet är ett riktigt minus, inte ett bindestreck. */
function pct(value: number): string {
  const s = Math.abs(value).toFixed(1).replace(".", ",");
  return `${value >= 0 ? "+" : "−"}${s} %`;
}

function digestSection(title: string, inner: string): string {
  return `<div style="margin:28px 0 0;padding-top:20px;border-top:1px solid #2a2e38;">
       <p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#ffffff;">${title}</p>
       ${inner}
     </div>`;
}

/**
 * VECKOBREVET — går till ALLA konton, inte bara Pro (ägarbeslut 2026-08-16).
 *
 * ⛔ **VARJE AVSNITT SOM SAKNAR DATA UTELÄMNAS HELT.** Ett brev med "0 prisfall"
 * och "+0,0 %" läser som att tjänsten är tom; ett brev med bara de avsnitt som
 * faktiskt bär något läser som att vi bara hör av oss när vi har något att säga.
 * Samma regel som "–" i pristabellen: vi hittar aldrig på en nolla.
 *
 * ⛔ **PLATTFORMSPULSEN ÄR SAMMA SIFFROR FÖR ALLA** och räknas EN gång per körning
 * — den är brevets skäl att finnas för den som varken har samling eller
 * bevakningar, och den är därför också det som avgör om ett annars tomt brev ändå
 * har innehåll.
 *
 * ⛔ **SIDFOTEN MÅSTE BÄRA AVANMÄLAN.** Det här är inget transaktionsmejl. Utan
 * en fungerande utloggad avregistreringslänk är spamknappen mottagarens enda
 * utväg, och den kostar foilio.se:s avsändarrykte permanent.
 */
export function weeklyDigestEmail(data: WeeklyDigestContent): EmailContent {
  const { pulse } = data;
  const parts: string[] = [];
  const textParts: string[] = [];

  // ---- Samlingen ----
  if (data.collection) {
    const c = data.collection;
    const changeHtml =
      c.changePercent != null && c.changeOre != null
        ? `<p style="margin:4px 0 0;font-size:14px;color:${c.changeOre >= 0 ? "#34d399" : "#f87171"};">${pct(
            c.changePercent
          )} senaste sju dagarna (${c.changeOre >= 0 ? "+" : "−"}${formatSek(Math.abs(c.changeOre))})</p>`
        : "";
    const moversHtml = c.movers.length
      ? `<p style="margin:16px 0 8px;font-size:13px;color:#9ca3af;">Veckans rörelser i din samling:</p>
         <ul style="line-height:1.7;color:#cbd5e1;padding-left:20px;margin:0;font-size:14px;">
           ${c.movers
             .map(
               (m) =>
                 `<li><strong style="color:#ffffff;">${m.name}</strong>${
                   m.setName ? ` <span style="color:#6b7280;">· ${m.setName}</span>` : ""
                 } — <span style="color:#34d399;">${pct(m.percent)}</span>${
                   m.valueOre != null ? ` · ${formatSek(m.valueOre)}/st` : ""
                 }</li>`
             )
             .join("\n           ")}
         </ul>`
      : "";
    parts.push(
      digestSection(
        "Din samling",
        `<p style="margin:0;font-size:24px;font-weight:800;color:#ffffff;">${formatSek(c.totalValueOre)}</p>
         ${changeHtml}
         ${moversHtml}`
      )
    );
    textParts.push(
      `— Din samling —\nVärde: ${formatSek(c.totalValueOre)}${
        c.changePercent != null && c.changeOre != null
          ? `\nSenaste sju dagarna: ${pct(c.changePercent)} (${c.changeOre >= 0 ? "+" : "−"}${formatSek(
              Math.abs(c.changeOre)
            )})`
          : ""
      }${
        c.movers.length
          ? `\nVeckans rörelser:\n${c.movers
              .map(
                (m) =>
                  `  · ${m.name}${m.setName ? ` (${m.setName})` : ""} ${pct(m.percent)}${
                    m.valueOre != null ? ` · ${formatSek(m.valueOre)}/st` : ""
                  }`
              )
              .join("\n")}`
          : ""
      }`
    );
  }

  // ---- Prisfall på bevakat ----
  if (data.drops.length) {
    parts.push(
      digestSection(
        "Prisfall på det du bevakar",
        `<ul style="line-height:1.7;color:#cbd5e1;padding-left:20px;margin:0;font-size:14px;">
           ${data.drops
             .map(
               (d) =>
                 `<li><a href="${d.url}" style="color:#ffffff;font-weight:600;text-decoration:none;">${d.title}</a> — <span style="color:#34d399;">${pct(
                   d.percent
                 )}</span>${d.priceOre != null ? ` · nu ${formatSek(d.priceOre)}` : ""}</li>`
             )
             .join("\n           ")}
         </ul>`
      )
    );
    textParts.push(
      `— Prisfall på det du bevakar —\n${data.drops
        .map(
          (d) =>
            `  · ${d.title} ${pct(d.percent)}${d.priceOre != null ? ` · nu ${formatSek(d.priceOre)}` : ""}\n    ${d.url}`
        )
        .join("\n")}`
    );
  }

  // ---- Restocks i bevakat ----
  if (data.restocks.length) {
    parts.push(
      digestSection(
        "Tillbaka i lager den här veckan",
        `<ul style="line-height:1.7;color:#cbd5e1;padding-left:20px;margin:0;font-size:14px;">
           ${data.restocks
             .map(
               (r) =>
                 `<li><a href="${r.url}" style="color:#ffffff;font-weight:600;text-decoration:none;">${r.title}</a> hos <strong style="color:#2dd4bf;">${r.retailerName}</strong>${
                   r.priceOre != null ? ` · ${formatSek(r.priceOre)}` : ""
                 }</li>`
             )
             .join("\n           ")}
         </ul>
         <p style="margin:12px 0 0;font-size:12px;color:#6b7280;">Lagret kan ha ändrats sedan vi räknade — heta varor tar slut fort.</p>`
      )
    );
    textParts.push(
      `— Tillbaka i lager den här veckan —\n${data.restocks
        .map(
          (r) =>
            `  · ${r.title} hos ${r.retailerName}${r.priceOre != null ? ` · ${formatSek(r.priceOre)}` : ""}\n    ${r.url}`
        )
        .join("\n")}\n  Lagret kan ha ändrats sedan vi räknade.`
    );
  }

  // ---- Plattformspulsen ----
  const pulseBits: string[] = [];
  const pulseTextBits: string[] = [];
  if (pulse.underMarketCount > 0) {
    pulseBits.push(
      `<p style="margin:0;line-height:1.6;color:#cbd5e1;">Just nu ligger <strong style="color:#ffffff;font-size:18px;">${pulse.underMarketCount}</strong> varor hos svenska butiker minst <strong style="color:#ffffff;">${pulse.minDiscountPercent} %</strong> under Cardmarket-priset.</p>`
    );
    pulseTextBits.push(
      `Just nu ligger ${pulse.underMarketCount} varor hos svenska butiker minst ${pulse.minDiscountPercent} % under Cardmarket-priset.`
    );
  }
  if (pulse.examples.length) {
    pulseBits.push(
      `<ul style="line-height:1.7;color:#cbd5e1;padding-left:20px;margin:12px 0 0;font-size:14px;">
         ${pulse.examples
           .map(
             (e) =>
               `<li><a href="${e.url}" style="color:#ffffff;font-weight:600;text-decoration:none;">${e.title}</a> — ${formatSek(
                 e.priceOre
               )} hos <strong style="color:#2dd4bf;">${e.retailerName}</strong> <span style="color:#34d399;">(${e.percentUnder} % under)</span></li>`
           )
           .join("\n         ")}
       </ul>`
    );
    pulseTextBits.push(
      pulse.examples
        .map(
          (e) =>
            `  · ${e.title} — ${formatSek(e.priceOre)} hos ${e.retailerName} (${e.percentUnder} % under)\n    ${e.url}`
        )
        .join("\n")
    );
  }
  const counters: string[] = [];
  if (pulse.restockCount > 0) counters.push(`${pulse.restockCount} restocks fångade`);
  if (pulse.newSetCount > 0)
    // "släppt", inte "i katalogen": talet räknar set med releaseDate i veckan, dvs
    // faktiska släpp. Se kommentaren i weekly-digest.ts — "i katalogen" räknade även
    // bokföringsrader för set från 2014 och läste som 33 nya släpp.
    counters.push(
      `${pulse.newSetCount} ${pulse.newSetCount === 1 ? "nytt set" : "nya set"} släppta`
    );
  if (counters.length) {
    pulseBits.push(
      `<p style="margin:16px 0 0;font-size:13px;color:#9ca3af;">Vi bevakade också butikerna åt dig: ${counters.join(
        " · "
      )}.</p>`
    );
    pulseTextBits.push(`Vi bevakade också butikerna åt dig: ${counters.join(" · ")}.`);
  }
  if (pulseBits.length) {
    parts.push(digestSection("Veckans läge på marknaden", pulseBits.join("\n         ")));
    textParts.push(`— Veckans läge på marknaden —\n${pulseTextBits.join("\n")}`);
  }

  const subject =
    pulse.underMarketCount > 0
      ? `Veckan på Foilio: ${pulse.underMarketCount} varor under marknadspris`
      : "Veckan på Foilio";

  // ⛔ Avanmälan i BÅDE sidfoten och textversionen. En länk som bara finns i
  // HTML-halvan är osynlig för den som läser i ren text.
  const footerReason = `Du får det här brevet för att du har ett konto på Foilio.<br>
      <a href="${data.unsubscribeUrl}" style="color:#9ca3af;">Avregistrera dig från veckobrevet</a> · du behåller dina pris- och restock-larm.`;

  // ⛔ Ingressen får inte lova något brevet inte innehåller. Har mottagaren varken
  // samling eller bevakningar är "vad din samling gjorde" en tom kula — då är
  // marknadsläget hela brevet, och nästa steg är att lägga upp något.
  const hasPersonal = !!data.collection || data.drops.length > 0 || data.restocks.length > 0;
  const intro = hasPersonal
    ? "Sammanfattningen av din vecka på Foilio: vad din samling gjorde, vad som hände med det du bevakar, och var fynden fanns."
    : "Här är veckans läge på den svenska Pokémon-marknaden. Lägg upp din samling och bevaka det du jagar, så handlar nästa brev om dina kort också.";

  const html = layout(
    `Hej ${data.name}, här är din vecka`,
    `<p style="line-height:1.6;color:#cbd5e1;">${intro}</p>
     ${parts.join("\n     ")}
     ${button(`${APP_URL}/produkter?sortera=prisfall`, "Se allt i appen")}`,
    footerReason
  );

  const text = `Hej ${data.name}!

${intro}

${textParts.join("\n\n")}

Se allt i appen: ${APP_URL}/produkter?sortera=prisfall

Du får det här brevet för att du har ett konto på Foilio.
Avregistrera dig från veckobrevet: ${data.unsubscribeUrl}
Foilio · Sveriges marknadsplats för Pokémon TCG`;

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
