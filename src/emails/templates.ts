/**
 * E-postmallar på svenska. Returnerar {subject, html, text}.
 * Mörkvänlig, enkel inline-stylad HTML med Foilio-branding.
 */

// ⛔ Bara rena konstanter får importeras hit: templates.ts når EDGE-bundlen via
// instrumentation → scheduler → notifications, där Node-API:er (t.ex. 'crypto')
// inte finns. social-links.ts är enbart strängar — se signup-code-noten nedan.
import { APP_STORE_URL, DISCORD_URL } from "@/lib/social-links";
// ⛔ discord-invites.ts är också bara strängar — inga Node-API:er, se noten ovan.
import { giveawayInviteUrl } from "@/lib/discord-invites";

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

// ⛔ **MALLEN LÄSER INTE MILJÖN.** Ett mejl renderas i ett jobb, i en webrequest och
// i en testkörning — bara ANROPAREN vet vilken sajt det gäller. 2026-08-16 satte
// workflowet `NEXT_PUBLIC_APP_URL=""` (repo-variabeln fanns inte), `?? `-reserven
// hoppades förbi den tomma strängen, och varje länk i det skarpa veckobrevet blev
// relativ: mejlklienten har ingen bas-URL och visade `http:///produkter`. Tyst.
// Veckobrevet tar därför in `appUrl`; övriga mallar använder konstanten nedan.
//
// ⛔ APEX, aldrig www: apex är kanonisk sedan 2026-08-14 och www 301:as av
// Cloudflare. En webbläsare följer den redirecten, men maskinella URL:er ska ändå
// peka rätt direkt.
const APP_URL = "https://foilio.se";

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

/**
 * ⛔ **VECKOBREVET HAR EGEN LAYOUT — DELA ALDRIG `layout()` MED LARMEN.**
 *
 * Larmen är en enda mening ("den här varan är i lager") och mår bra av ett smalt,
 * textigt skal. Veckobrevet är ett REDAKTIONELLT brev som ska sälja appen: det
 * behöver bilder, avsnitt, progressbar och en egen åtgärd per avsnitt. Ett skal
 * som försöker göra båda blir dåligt på båda — och varje ändring här hade annars
 * riskerat att flytta sig in i restock-larmen, som är det mejl vi minst av allt
 * vill röra.
 *
 * ⛔ **E-POST-HTML ÄR INTE WEBB-HTML.** Tabeller, inline-stilar, absoluta URL:er,
 * max 600 px. Ingen flexbox, inget `<style>`-block, inga externa resurser, inga
 * `%`-breddade `<div>`-ar (progressbaren är en tabellcell just därför).
 *
 * ⛔ **VARJE CELL SÄTTER SIN EGEN BAKGRUNDS- OCH TEXTFÄRG.** Gmail och Outlook
 * tvingar ofta ljust läge och ärver inte färg nedåt — en cell som litar på arv
 * blir svart text på svart yta hos någon.
 */

/** Brevets palett. SVART yta, turkos signatur — aldrig blått. */
const D_PAGE = "#000000";
const D_CARD = "#0b0d12";
const D_PANEL = "#12171f";
const D_LINE = "#1f2430";
const D_TEXT = "#e5e7eb";
const D_MUTED = "#9ca3af";
const D_WHITE = "#ffffff";
const D_ACCENT = "#2dd4bf";
const D_UP = "#34d399";
const D_DOWN = "#f87171";
const D_FONT = "'Segoe UI',Arial,sans-serif";

/**
 * HTML-escape för allt som kommer ur databasen. Produkttitlar är SKRAPADE ur
 * butiksfeedar — ett `&` eller ett `<` i en titel får aldrig kunna stänga en
 * attributsträng i ett massutskick.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Ett kort i samlingen som rört sig mest på sju dagar. */
export interface DigestMover {
  name: string;
  setName: string | null;
  percent: number;
  valueOre: number | null;
  /** ABSOLUT bild-URL (jobbet gör den absolut). Saknas den renderas raden utan bild. */
  imageUrl?: string | null;
  /** Produktsidan. Saknas den blir namnet vanlig text — aldrig en död länk. */
  url?: string | null;
}

/** Prisfall på en produkt användaren bevakar. `percent` är NEGATIV. */
export interface DigestDrop {
  title: string;
  url: string;
  priceOre: number | null;
  percent: number;
  imageUrl?: string | null;
}

/** Restock i ett bevakat set eller på en bevakad produkt. */
export interface DigestRestock {
  title: string;
  url: string;
  retailerName: string;
  priceOre: number | null;
  imageUrl?: string | null;
}

/** Ett butiksfynd under Cardmarket-pris. `percentUnder` är POSITIV. */
export interface DigestDealExample {
  title: string;
  url: string;
  retailerName: string;
  priceOre: number;
  percentUnder: number;
}

/**
 * Hur långt användaren kommit i ett set hen faktiskt samlar på.
 *
 * Den mest "custom" ytan brevet har: ingen annan avsändare kan skriva "64 av 165
 * i Prismatic Evolutions" till just den här mottagaren. `url` pekar på setet.
 */
export interface DigestSetProgress {
  setName: string;
  owned: number;
  total: number;
  url: string;
}

export interface WeeklyDigestContent {
  name: string;
  /** Signerad avanmälan (src/lib/unsubscribe-token.ts). Obligatorisk — se sidfoten. */
  unsubscribeUrl: string;
  /**
   * ⛔ BAS-URL:EN KOMMER IN, MALLEN LÄSER ALDRIG MILJÖN. Ett mejl renderas i ett
   * jobb, i en webrequest och i en testkörning — bara anroparen vet vilken sajt
   * det gäller. Den 2026-08-16 gav en tom `NEXT_PUBLIC_APP_URL` varenda länk i
   * det skarpa utskicket formen `http:///produkter`, tyst.
   */
  appUrl: string;
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
  /** Påbörjade set, mest kompletta först. Utelämnas när inget set är påbörjat. */
  setProgress?: DigestSetProgress[];
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

/**
 * Miniatyr + text, som en tabellrad.
 *
 * ⛔ Bilden får ALDRIG bära raden. Outlook blockerar bilder som standard och
 * `alt` är avsiktligt TOMT: titeln står redan i cellen bredvid, och en alt-text
 * som upprepar den fyller rutan med dubbeltext hos precis de mottagare som har
 * bilderna avstängda. Saknas `imageUrl` renderas ingen cell alls — texten
 * flyttar bara ut till kanten, layouten går inte sönder.
 */
function mediaRow(imageUrl: string | null | undefined, inner: string): string {
  const thumb = imageUrl
    ? `<td width="52" valign="top" style="width:52px;padding:0 12px 0 0;">
              <img src="${esc(imageUrl)}" alt="" width="52" height="52" style="display:block;width:52px;height:52px;border:0;border-radius:8px;background-color:#171d26;object-fit:contain;">
            </td>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 14px;">
          <tr>
            ${thumb}<td valign="top" style="font-family:${D_FONT};font-size:14px;line-height:1.5;color:${D_TEXT};">${inner}</td>
          </tr>
        </table>`;
}

/** Titeln som länk när vi har en, annars som ren text. Aldrig en död `href`. */
function titleLink(title: string, url?: string | null): string {
  const strong = `<strong style="color:${D_WHITE};font-weight:700;">${esc(title)}</strong>`;
  return url ? `<a href="${esc(url)}" style="color:${D_WHITE};text-decoration:none;">${strong}</a>` : strong;
}

/**
 * Progressbaren för set-komplettering.
 *
 * ⛔ TVÅ TABELLCELLER MED BAKGRUNDSFÄRG, aldrig en `<div>` med `width:%`. Outlook
 * renderar tabeller med Word-motorn och en procentbreddad div blir antingen
 * fullbred eller osynlig. Andelen golvas på 4 % så en nyss påbörjad samling ändå
 * syns som ett streck.
 */
function progressBar(owned: number, total: number): string {
  const raw = total > 0 ? Math.round((owned / total) * 100) : 0;
  const filled = Math.max(4, Math.min(100, raw));
  const rest = 100 - filled;
  const cell = (w: number, color: string) =>
    `<td width="${w}%" height="8" style="width:${w}%;height:8px;line-height:8px;font-size:0;background-color:${color};border-radius:4px;">&nbsp;</td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:10px 0 0;">
          <tr>${cell(filled, D_ACCENT)}${rest > 0 ? cell(rest, "#1a1f29") : ""}</tr>
        </table>`;
}

/** Den turkosa huvudknappen. Tabell, inte `<a>` med padding — Outlook igen. */
function digestButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:20px 0 0;">
          <tr>
            <td align="center" bgcolor="${D_ACCENT}" style="background-color:${D_ACCENT};border-radius:8px;">
              <a href="${esc(url)}" style="display:inline-block;padding:13px 28px;font-family:${D_FONT};font-size:15px;font-weight:700;color:#04110f;text-decoration:none;">${esc(label)}</a>
            </td>
          </tr>
        </table>`;
}

/** Ett avsnitt i brevet, byggt en gång och renderat antingen som ledare eller som löpande. */
interface DigestBlock {
  key: "restocks" | "drops" | "sets" | "collection" | "pulse";
  title: string;
  inner: string;
  note?: string;
  /** ⛔ Varje avsnitt har EN egen åtgärd, och den går till RÄTT sida. */
  action?: { url: string; label: string };
  text: string;
}

/**
 * LEDAREN FÅR EN EGEN RUTA. Resten löper på med en tunn linje emellan.
 *
 * Det är hela skillnaden mot det gamla brevet: där låg samlingens totalvärde
 * överst varje vecka, oavsett om det hänt något. Nu är det VECKANS HÄNDELSE som
 * ligger överst, och den ser också ut som en händelse.
 */
function digestBlockHtml(block: DigestBlock, lead: boolean): string {
  const note = block.note
    ? `<p style="margin:12px 0 0;font-family:${D_FONT};font-size:12px;line-height:1.5;color:${D_MUTED};">${block.note}</p>`
    : "";
  const action = block.action
    ? `<p style="margin:16px 0 0;font-family:${D_FONT};font-size:13px;line-height:1.4;">
              <a href="${esc(block.action.url)}" style="color:${D_ACCENT};text-decoration:none;font-weight:700;">${esc(block.action.label)} &rarr;</a>
            </p>`
    : "";

  if (lead) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;margin:0 0 4px;">
        <tr>
          <td bgcolor="${D_PANEL}" style="background-color:${D_PANEL};border:1px solid ${D_LINE};border-left:3px solid ${D_ACCENT};border-radius:12px;padding:20px 18px;color:${D_TEXT};">
            <p style="margin:0 0 14px;font-family:${D_FONT};font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${D_ACCENT};">${esc(block.title)}</p>
            ${block.inner}${note}${action}
          </td>
        </tr>
      </table>`;
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:26px 0 0;">
        <tr>
          <td style="padding:22px 0 0;border-top:1px solid ${D_LINE};background-color:${D_CARD};color:${D_TEXT};">
            <p style="margin:0 0 14px;font-family:${D_FONT};font-size:16px;font-weight:700;color:${D_WHITE};">${esc(block.title)}</p>
            ${block.inner}${note}${action}
          </td>
        </tr>
      </table>`;
}

/**
 * Brevets skal.
 *
 * ⛔ **INGEN LOGOTYPBILD.** `public/brand/foilio-logo.png` finns, men den är 800 kB,
 * blockeras av Outlook som standard och blev en trasig ruta i det skarpa utskicket
 * 2026-08-16 (tom bas-URL). En ordbild i text kan inte gå sönder, väger noll och
 * renderas likadant i varje klient. Bilderna i brevet ska vara KORT — det är de
 * som gör mejlet till Foilio.
 */
function digestLayout(preheader: string, headline: string, bodyHtml: string, footerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
</head>
<body style="margin:0;padding:0;background-color:${D_PAGE};">
  <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${D_PAGE};">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${D_PAGE}" style="width:100%;border-collapse:collapse;background-color:${D_PAGE};">
    <tr>
      <td align="center" style="padding:24px 12px;background-color:${D_PAGE};">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse;">
          <tr>
            <td align="left" style="padding:0 4px 18px;font-family:${D_FONT};">
              <span style="font-size:20px;font-weight:800;letter-spacing:5px;color:${D_ACCENT};text-transform:uppercase;">Foilio</span>
              <span style="font-size:12px;font-weight:600;letter-spacing:1px;color:${D_MUTED};text-transform:uppercase;">&nbsp;&middot;&nbsp;Veckobrevet</span>
            </td>
          </tr>
          <tr>
            <td bgcolor="${D_CARD}" style="background-color:${D_CARD};border:1px solid ${D_LINE};border-radius:16px;padding:26px 20px;color:${D_TEXT};font-family:${D_FONT};">
              <h1 style="margin:0 0 18px;font-family:${D_FONT};font-size:22px;line-height:1.3;font-weight:800;color:${D_WHITE};">${headline}</h1>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 8px 0;font-family:${D_FONT};font-size:12px;line-height:1.7;color:#6b7280;">
              ${footerHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * VECKOBREVET — går till ALLA konton, inte bara Pro (ägarbeslut 2026-08-16).
 *
 * ⛔ **VARJE AVSNITT SOM SAKNAR DATA UTELÄMNAS HELT.** Ett brev med "0 prisfall"
 * och "+0,0 %" läser som att tjänsten är tom; ett brev med bara de avsnitt som
 * faktiskt bär något läser som att vi bara hör av oss när vi har något att säga.
 * Samma regel som "–" i pristabellen: vi hittar aldrig på en nolla.
 *
 * ⛔ **LEDAREN VÄLJS AV VAD SOM HÄNT, ALDRIG AV EN FAST ORDNING.** Första
 * versionen ledde med samlingens totalvärde och "+0,1 % senaste sju dagarna" —
 * den tråkigaste siffran vi äger, överst, varje vecka. Ordningen nedan är
 * NYHETSVÄRDE: ett restock på något du bevakar slår ett prisfall, som slår hur
 * långt du kommit i ett set, som slår portföljens rörelse. Är veckan händelselös
 * är plattformspulsen ledare.
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
  // Trailing slash bort: `${base}/samling` får aldrig bli `//samling`. Reserven är
  // apex — den är kanonisk, och en tom sträng in ska inte kunna ge en relativ länk.
  const base = (data.appUrl || "https://foilio.se").replace(/\/+$/, "");
  const setProgress = data.setProgress ?? [];

  const blocks: DigestBlock[] = [];

  // ---- 1. Tillbaka i lager (högst nyhetsvärde: det tar slut) ----
  if (data.restocks.length) {
    const n = data.restocks.length;
    const rows = data.restocks
      .map((r) =>
        mediaRow(
          r.imageUrl,
          `${titleLink(r.title, r.url)}<br>
                <span style="color:${D_ACCENT};font-weight:700;">${esc(r.retailerName)}</span>${
                  r.priceOre != null
                    ? ` <span style="color:${D_MUTED};">&middot; ${formatSek(r.priceOre)}</span>`
                    : ""
                }`
        )
      )
      .join("\n          ");
    blocks.push({
      key: "restocks",
      title: "Tillbaka i lager",
      inner: `<p style="margin:0 0 16px;font-family:${D_FONT};font-size:14px;line-height:1.6;color:${D_TEXT};">${
        n === 1 ? "En vara du bevakar" : `${n} varor du bevakar`
      } kom tillbaka i lager den här veckan.</p>
          ${rows}`,
      note: "Lagret kan ha ändrats sedan vi räknade — heta varor tar slut fort.",
      action: { url: `${base}/bevakningar`, label: "Sköt dina bevakningar" },
      text: `— Tillbaka i lager —\n${
        n === 1 ? "En vara du bevakar" : `${n} varor du bevakar`
      } kom tillbaka i lager den här veckan.\n${data.restocks
        .map(
          (r) =>
            `  · ${r.title} hos ${r.retailerName}${r.priceOre != null ? ` · ${formatSek(r.priceOre)}` : ""}\n    ${r.url}`
        )
        .join("\n")}\n  Lagret kan ha ändrats sedan vi räknade.\n  Sköt dina bevakningar: ${base}/bevakningar`,
    });
  }

  // ---- 2. Prisfall på bevakat ----
  if (data.drops.length) {
    const rows = data.drops
      .map((d) =>
        mediaRow(
          d.imageUrl,
          `${titleLink(d.title, d.url)}<br>
                <span style="color:${D_UP};font-weight:700;">${pct(d.percent)}</span>${
                  d.priceOre != null
                    ? ` <span style="color:${D_MUTED};">&middot; nu ${formatSek(d.priceOre)}</span>`
                    : ""
                }`
        )
      )
      .join("\n          ");
    blocks.push({
      key: "drops",
      title: "Prisfall på det du bevakar",
      inner: rows,
      action: { url: `${base}/produkter?sortera=prisfall`, label: "Se veckans största prisfall" },
      text: `— Prisfall på det du bevakar —\n${data.drops
        .map(
          (d) =>
            `  · ${d.title} ${pct(d.percent)}${d.priceOre != null ? ` · nu ${formatSek(d.priceOre)}` : ""}\n    ${d.url}`
        )
        .join("\n")}\n  Se veckans största prisfall: ${base}/produkter?sortera=prisfall`,
    });
  }

  // ---- 3. Set-komplettering ----
  if (setProgress.length) {
    const rows = setProgress
      .map((s) => {
        const left = Math.max(0, s.total - s.owned);
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 18px;">
            <tr>
              <td style="font-family:${D_FONT};font-size:14px;line-height:1.5;color:${D_TEXT};">
                <a href="${esc(s.url)}" style="color:${D_WHITE};text-decoration:none;"><strong style="color:${D_WHITE};font-weight:700;">${esc(
                  s.setName
                )}</strong></a><br>
                <span style="color:${D_MUTED};">${s.owned} av ${s.total} kort &middot; </span><span style="color:${D_ACCENT};font-weight:700;">${left} kvar</span>
                ${progressBar(s.owned, s.total)}
              </td>
            </tr>
          </table>`;
      })
      .join("\n          ");
    const top = setProgress[0];
    blocks.push({
      key: "sets",
      title: "Så långt har du kommit",
      inner: rows,
      action: { url: top.url, label: `Fyll luckorna i ${top.setName}` },
      text: `— Så långt har du kommit —\n${setProgress
        .map(
          (s) =>
            `  · ${s.setName}: ${s.owned} av ${s.total} kort · ${Math.max(0, s.total - s.owned)} kvar\n    ${s.url}`
        )
        .join("\n")}`,
    });
  }

  // ---- 4. Samlingen ----
  if (data.collection) {
    const c = data.collection;
    const changeHtml =
      c.changePercent != null && c.changeOre != null
        ? `<p style="margin:6px 0 0;font-family:${D_FONT};font-size:14px;color:${
            c.changeOre >= 0 ? D_UP : D_DOWN
          };">${pct(c.changePercent)} senaste sju dagarna (${c.changeOre >= 0 ? "+" : "−"}${formatSek(
            Math.abs(c.changeOre)
          )})</p>`
        : "";
    const moversHtml = c.movers.length
      ? `<p style="margin:20px 0 12px;font-family:${D_FONT};font-size:13px;color:${D_MUTED};">Störst rörelse den här veckan:</p>
          ${c.movers
            .map((m) =>
              mediaRow(
                m.imageUrl,
                `${titleLink(m.name, m.url)}${
                  m.setName ? `<br><span style="color:${D_MUTED};font-size:13px;">${esc(m.setName)}</span>` : ""
                }<br>
                <span style="color:${m.percent >= 0 ? D_UP : D_DOWN};font-weight:700;">${pct(m.percent)}</span>${
                  m.valueOre != null
                    ? ` <span style="color:${D_MUTED};">&middot; ${formatSek(m.valueOre)}/st</span>`
                    : ""
                }`
              )
            )
            .join("\n          ")}`
      : "";
    blocks.push({
      key: "collection",
      title: "Din samling",
      inner: `<p style="margin:0;font-family:${D_FONT};font-size:26px;font-weight:800;color:${D_WHITE};">${formatSek(
        c.totalValueOre
      )}</p>${changeHtml}${moversHtml}`,
      action: { url: `${base}/samling`, label: "Öppna samlingen" },
      text: `— Din samling —\nVärde: ${formatSek(c.totalValueOre)}${
        c.changePercent != null && c.changeOre != null
          ? `\nSenaste sju dagarna: ${pct(c.changePercent)} (${c.changeOre >= 0 ? "+" : "−"}${formatSek(
              Math.abs(c.changeOre)
            )})`
          : ""
      }${
        c.movers.length
          ? `\nStörst rörelse:\n${c.movers
              .map(
                (m) =>
                  `  · ${m.name}${m.setName ? ` (${m.setName})` : ""} ${pct(m.percent)}${
                    m.valueOre != null ? ` · ${formatSek(m.valueOre)}/st` : ""
                  }`
              )
              .join("\n")}`
          : ""
      }\n  Öppna samlingen: ${base}/samling`,
    });
  }

  // ---- 5. Plattformspulsen ----
  const pulseBits: string[] = [];
  const pulseTextBits: string[] = [];
  if (pulse.underMarketCount > 0) {
    pulseBits.push(
      `<p style="margin:0;font-family:${D_FONT};font-size:15px;line-height:1.6;color:${D_TEXT};">Just nu ligger <strong style="color:${D_ACCENT};font-size:20px;">${pulse.underMarketCount}</strong> varor hos svenska butiker minst <strong style="color:${D_WHITE};">${pulse.minDiscountPercent} %</strong> under Cardmarket-priset.</p>`
    );
    pulseTextBits.push(
      `Just nu ligger ${pulse.underMarketCount} varor hos svenska butiker minst ${pulse.minDiscountPercent} % under Cardmarket-priset.`
    );
  }
  if (pulse.examples.length) {
    pulseBits.push(
      pulse.examples
        .map((e) =>
          mediaRow(
            null,
            `${titleLink(e.title, e.url)}<br>
                <span style="color:${D_MUTED};">${formatSek(e.priceOre)} hos </span><span style="color:${D_ACCENT};font-weight:700;">${esc(
                  e.retailerName
                )}</span> <span style="color:${D_UP};font-weight:700;">${e.percentUnder} % under</span>`
          )
        )
        .join("\n          ")
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
      pulse.newSetCount === 1 ? "1 nytt set släppt" : `${pulse.newSetCount} nya set släppta`
    );
  if (counters.length) {
    pulseBits.push(
      `<p style="margin:16px 0 0;font-family:${D_FONT};font-size:13px;line-height:1.6;color:${D_MUTED};">Vi bevakade butikerna åt dig medan du gjorde annat: ${counters.join(
        " &middot; "
      )}.</p>`
    );
    pulseTextBits.push(`Vi bevakade butikerna åt dig medan du gjorde annat: ${counters.join(" · ")}.`);
  }
  const pulseHasContent = pulseBits.length > 0;
  if (pulseHasContent) {
    blocks.push({
      key: "pulse",
      title: "Läget på marknaden",
      inner: pulseBits.join("\n          "),
      action: { url: `${base}/produkter?sortera=prisfall`, label: "Jaga fynden i katalogen" },
      text: `— Läget på marknaden —\n${pulseTextBits.join("\n")}\n  Jaga fynden: ${base}/produkter?sortera=prisfall`,
    });
  }

  // ---- Ledare, ämnesrad och ingress ----
  // Blocken ligger redan i nyhetsvärdesordning, så ledaren är helt enkelt det
  // första som bar innehåll. ⛔ Ändra ordningen ovan och du ändrar ämnesraden.
  const lead = blocks[0];
  const firstSet = setProgress[0];
  const leadCopy = ((): { subject: string; headline: string; preheader: string } => {
    switch (lead?.key) {
      case "restocks": {
        const n = data.restocks.length;
        const first = data.restocks[0];
        return {
          subject:
            n === 1
              ? `Tillbaka i lager: ${first.title} · Foilio`
              : `${n} av dina bevakade är i lager igen · Foilio`,
          headline:
            n === 1
              ? "Något du bevakar är tillbaka i lager"
              : `${n} av dina bevakade är tillbaka i lager`,
          preheader: `${first.title} hos ${first.retailerName}${
            n > 1 ? ` och ${n - 1} till` : ""
          }.`,
        };
      }
      case "drops": {
        const n = data.drops.length;
        const first = data.drops[0];
        return {
          subject:
            n === 1
              ? `${pct(first.percent)} på ${first.title} · Foilio`
              : `Prisfall på ${n} av dina bevakade · Foilio`,
          headline: n === 1 ? "Priset föll på något du bevakar" : `Priset föll på ${n} av dina bevakade`,
          preheader: `${first.title} ${pct(first.percent)}${
            first.priceOre != null ? ` — nu ${formatSek(first.priceOre)}` : ""
          }.`,
        };
      }
      case "sets": {
        const left = firstSet ? Math.max(0, firstSet.total - firstSet.owned) : 0;
        return {
          subject: `${left} kort kvar i ${firstSet?.setName ?? "ditt set"} · Foilio`,
          headline: `Du är ${left} kort från att fylla ${firstSet?.setName ?? "setet"}`,
          preheader: firstSet
            ? `${firstSet.owned} av ${firstSet.total} kort i hus. Vi visar vilka som fattas.`
            : "",
        };
      }
      case "collection": {
        const c = data.collection!;
        // ⛔ En rörelse under en procent är ingen nyhet och får ALDRIG bli rubrik —
        // "+0,1 % senaste sju dagarna" var precis det som fick brevet att läsa som
        // ett kontoutdrag. Värdet i sig duger som rubrik; procenten står i avsnittet.
        const big = c.changePercent != null && Math.abs(c.changePercent) >= 1;
        return {
          subject: big
            ? `Din samling ${pct(c.changePercent!)} den här veckan · Foilio`
            : `Din samling: ${formatSek(c.totalValueOre)} · Foilio`,
          headline: big
            ? `Din samling gick ${pct(c.changePercent!)} den här veckan`
            : `Din samling står i ${formatSek(c.totalValueOre)}`,
          preheader: c.movers.length
            ? `Störst rörelse: ${c.movers[0].name} ${pct(c.movers[0].percent)}.`
            : "Se hur kurvan rört sig.",
        };
      }
      case "pulse":
        return {
          subject:
            pulse.underMarketCount > 0
              ? `${pulse.underMarketCount} varor under marknadspris just nu · Foilio`
              : "Veckan på Foilio",
          headline:
            pulse.underMarketCount > 0
              ? `${pulse.underMarketCount} varor ligger under marknadspris`
              : "Veckan på den svenska Pokémon-marknaden",
          preheader: "Vi räknade om hela katalogen mot Cardmarket i natt.",
        };
      default:
        return {
          subject: "Veckan på Foilio",
          headline: "Din vecka på Foilio",
          preheader: "Lägg upp din samling så handlar nästa brev om dina kort.",
        };
    }
  })();

  const hasPersonal =
    !!data.collection || data.drops.length > 0 || data.restocks.length > 0 || setProgress.length > 0;
  const intro = hasPersonal
    ? `Hej ${data.name}! Här är veckan som gick — dina kort, dina bevakningar och var fynden fanns.`
    : `Hej ${data.name}! Du har inget upplagt ännu, så det här brevet handlar om marknaden. Lägg upp din samling och bevaka det du jagar, så handlar nästa om dina kort.`;

  // ---- "Det här kan Foilio" ----
  // ⛔ Diskret och SIST. Den är för den som inte redan vet vad appen gör — inte en
  // funktionslista som konkurrerar med veckans nyhet. Max en mening per funktion.
  const capability = (label: string, path: string, line: string) =>
    `<tr>
              <td style="padding:0 0 10px;font-family:${D_FONT};font-size:13px;line-height:1.6;color:${D_MUTED};">
                <a href="${base}${path}" style="color:${D_ACCENT};text-decoration:none;font-weight:700;">${label}</a> <span style="color:${D_MUTED};">${line}</span>
              </td>
            </tr>`;
  const capabilitiesHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:28px 0 0;">
        <tr>
          <td style="padding:22px 0 0;border-top:1px solid ${D_LINE};background-color:${D_CARD};">
            <p style="margin:0 0 14px;font-family:${D_FONT};font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${D_MUTED};">Det här kan Foilio</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
              ${capability("Skanna kort", "/skanna", "— rikta kameran mot kortet, vi hittar det och lägger det i samlingen.")}
              ${capability("Bevaka lager", "/bevakningar", "— vi håller koll på 42 svenska butiker och larmar när något du jagar dyker upp.")}
              ${capability("Värdera samlingen", "/samling", "— dagsfärskt värde på varje kort, och kurvan bakåt.")}
              ${capability("Gradera med AI", "/gradera", "— fota kortet och få ett skickomdöme innan du skickar in det.")}
            </table>
          </td>
        </tr>
      </table>`;
  const capabilitiesText = `— Det här kan Foilio —
  · Skanna kort — rikta kameran mot kortet, vi hittar det och lägger det i samlingen: ${base}/skanna
  · Bevaka lager — vi håller koll på 42 svenska butiker och larmar när något du jagar dyker upp: ${base}/bevakningar
  · Värdera samlingen — dagsfärskt värde på varje kort, och kurvan bakåt: ${base}/samling
  · Gradera med AI — fota kortet och få ett skickomdöme innan du skickar in det: ${base}/gradera`;

  // ---- Slutknappen: nästa steg för just den här mottagaren ----
  // ⛔ Ett tomt konto ska ALDRIG få "Se allt i appen". Den som saknar samling ska
  // få veta vad hen ska göra först — det är hela skillnaden mot ett brev som bara
  // rapporterar.
  const finalCta = !data.collection
    ? { url: `${base}/samling`, label: "Lägg upp din samling" }
    : data.drops.length === 0 && data.restocks.length === 0
    ? { url: `${base}/bevakningar`, label: "Bevaka det du jagar" }
    : { url: `${base}/dashboard`, label: "Öppna Foilio" };

  const bodyHtml = `<p style="margin:0 0 22px;font-family:${D_FONT};font-size:15px;line-height:1.6;color:${D_TEXT};">${esc(
    intro
  )}</p>
      ${blocks.map((b, i) => digestBlockHtml(b, i === 0)).join("\n      ")}
      ${digestButton(finalCta.url, finalCta.label)}
      ${capabilitiesHtml}`;

  // ⛔ Avanmälan i BÅDE sidfoten och textversionen. En länk som bara finns i
  // HTML-halvan är osynlig för den som läser i ren text.
  const footerHtml = `Du får det här brevet för att du har ett konto på Foilio.<br>
              <a href="${esc(data.unsubscribeUrl)}" style="color:#9ca3af;">Avregistrera dig från veckobrevet</a> &middot; du behåller dina pris- och restock-larm.<br>
              © Foilio &middot; Sveriges marknadsplats för Pokémon TCG`;

  const html = digestLayout(esc(leadCopy.preheader), esc(leadCopy.headline), bodyHtml, footerHtml);

  const text = `FOILIO · VECKOBREVET

${leadCopy.headline}

${intro}

${blocks.map((b) => b.text).join("\n\n")}

${finalCta.label}: ${finalCta.url}

${capabilitiesText}

Du får det här brevet för att du har ett konto på Foilio.
Avregistrera dig från veckobrevet: ${data.unsubscribeUrl}
Foilio · Sveriges marknadsplats för Pokémon TCG`;

  return { subject: leadCopy.subject, html, text };
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

/**
 * ENGÅNGSUTSKICK 2026-08-23: restock-larmen via mejl/push är pausade.
 *
 * ⛔ KORT MED FLIT (ägarbeslut). Ingen motivering av VARFÖR vi pausade, ingen
 * förklaring av hur Discord-lanen fungerar, ingen beskrivning av hur mejl/push
 * fungerade förut. Mottagaren behöver veta tre saker: att det är pausat, att
 * inget är raderat, och var larmen finns under tiden. Allt utöver det gör
 * mejlet till en ursäkt.
 *
 * ⛔ INGET SLUTDATUM. Ett datum vi missar är värre än "vi säger till".
 *
 * ⛔ INGEN `unsubscribeUrl` — se anroparen (scripts/send-restock-paused-notice.ts)
 * för skälet: det här är ett driftmeddelande om mottagarens eget konto, inte
 * nyheter. (Nyhetsmejl har en egen typ, `news` — se releaseNotesEmail.)
 */
export function restockPausedEmail(name: string): EmailContent {
  const subject = "Restock-larmen via mejl är pausade";
  const html = layout(
    "Restock-larmen är pausade",
    `<p style="line-height:1.6;color:#cbd5e1;">Hej ${name}! Restock-larm via mejl och push är pausade tills vidare.</p>
     <p style="line-height:1.6;color:#cbd5e1;">Din bevakningslista ligger kvar. Vi säger till när de är igång igen.</p>
     <div style="background-color:#111827;border:1px solid #2a2e38;border-radius:10px;padding:20px;margin:24px 0;">
       <p style="margin:0;line-height:1.6;color:#cbd5e1;">Vill du ha restock-larm under tiden? De går ut i vår <strong style="color:#2dd4bf;">Discord</strong> — snabbare, och gratis.</p>
     </div>
     ${button(DISCORD_URL, "Gå med i Discord")}
     <p style="line-height:1.6;color:#6b7280;font-size:13px;margin:16px 0 0;">Prisbevakningar fungerar som vanligt.</p>`
  );
  const text =
    `Hej ${name}!\n\n` +
    `Restock-larm via mejl och push är pausade tills vidare.\n\n` +
    `Din bevakningslista ligger kvar. Vi säger till när de är igång igen.\n\n` +
    `Vill du ha restock-larm under tiden? De går ut i vår Discord — snabbare, och gratis.\n` +
    `${DISCORD_URL}\n\n` +
    `Prisbevakningar fungerar som vanligt.` +
    textFooter;
  return { subject, html, text };
}

/**
 * Engångsbesked till användare som fick ett TOMT dubbelkonto när de loggade in
 * med Apple och "Dölj min e-post": relay-adressen matchade inte kontot de redan
 * hade, så `findOrCreateOAuthUser` födde ett nytt. Skickas EFTER att `appleId`
 * flyttats till ursprungskontot och dubbletten raderats, och till den RIKTIGA
 * adressen — relay-adresser studsar om avsändardomänen inte är registrerad hos
 * Apples relay-tjänst. Driftmeddelande om eget konto ⇒ ingen `unsubscribeUrl`.
 */
export function appleRelayLinkedEmail(name: string, originalEmail: string): EmailContent {
  const subject = "Din Apple-inloggning är nu kopplad till ditt vanliga Foilio-konto";
  const html = layout(
    "Ditt konto är ihopkopplat igen",
    `<p style="line-height:1.6;color:#cbd5e1;">Hej ${name}!</p>
     <p style="line-height:1.6;color:#cbd5e1;">Vi såg att du loggade in med Apple den 1 september. Eftersom <strong style="color:#ffffff;">Dölj min e-post</strong> var valt fick vi en anonym adress från Apple i stället för din vanliga, och då kunde vi inte se att det var du. Därför skapades ett nytt, tomt konto i stället för att du hamnade i ditt eget.</p>
     <p style="line-height:1.6;color:#cbd5e1;">Det är fixat nu. Din Apple-inloggning är kopplad till ditt ursprungliga konto (<strong style="color:#ffffff;">${originalEmail}</strong>) och det tomma dubbelkontot är borttaget. Din samling, dina skanningar och dina utmärkelser finns kvar precis som förut.</p>
     <div style="background-color:#111827;border:1px solid #2a2e38;border-radius:10px;padding:20px;margin:24px 0;">
       <p style="margin:0;line-height:1.6;color:#cbd5e1;">Nästa gång du öppnar appen kan du logga in <strong style="color:#2dd4bf;">med Apple</strong> eller <strong style="color:#2dd4bf;">med e-post och lösenord</strong> som tidigare. Båda leder till samma konto, och du behöver inte ändra något i dina Apple-inställningar.</p>
     </div>
     ${button(`${APP_URL}/logga-in`, "Öppna Foilio")}
     <p style="line-height:1.6;color:#6b7280;font-size:13px;margin:16px 0 0;">Ser något fel ut? Svara på det här mejlet så hjälper vi till.</p>`
  );
  const text =
    `Hej ${name}!\n\n` +
    `Vi såg att du loggade in med Apple den 1 september. Eftersom "Dölj min e-post" var valt fick vi en anonym adress från Apple i stället för din vanliga, och då kunde vi inte se att det var du. Därför skapades ett nytt, tomt konto i stället för att du hamnade i ditt eget.\n\n` +
    `Det är fixat nu. Din Apple-inloggning är kopplad till ditt ursprungliga konto (${originalEmail}) och det tomma dubbelkontot är borttaget. Din samling, dina skanningar och dina utmärkelser finns kvar precis som förut.\n\n` +
    `Nästa gång du öppnar appen kan du logga in med Apple eller med e-post och lösenord som tidigare. Båda leder till samma konto, och du behöver inte ändra något i dina Apple-inställningar.\n\n` +
    `Öppna Foilio: ${APP_URL}/logga-in\n\n` +
    `Ser något fel ut? Svara på det här mejlet så hjälper vi till.` +
    textFooter;
  return { subject, html, text };
}

/**
 * NYHETSMEJL PER SLÄPP — "det här är nytt i Foilio". Skickas av
 * scripts/send-release-notes.ts (förhandsgranskning till ägaren först).
 *
 * ⛔ `unsubscribeUrl` ÄR OBLIGATORISK. Det här är produktnyheter, inte ett
 * driftmeddelande som restockPausedEmail — mottagaren måste kunna säga nej på
 * ett klick, och typen är `news` (egen spak i inställningarna), aldrig `weekly`.
 *
 * ⛔ INGA PÅSTÅENDEN SOM INTE GÄLLER FÖR ALLA: japanska singlar finns i webben
 * och i VARJE appversion (appen är ett skal över webben); inloggningen och
 * gästskanningen kräver app 1.1 — därav uppdatera-knappen, och därav att
 * texten säger det.
 */
export function releaseNotesEmail(input: { name: string; unsubscribeUrl: string }): EmailContent {
  const { name, unsubscribeUrl } = input;
  const subject = "Nytt i Foilio: japanska singlar, Google-/Apple-inloggning och skanning utan konto";
  const item = (title: string, body: string) =>
    `<div style="padding:14px 0;border-top:1px solid #2a2e38;">
       <p style="margin:0 0 4px;font-weight:700;color:#ffffff;">${title}</p>
       <p style="margin:0;line-height:1.6;color:#cbd5e1;">${body}</p>
     </div>`;
  const html = layout(
    "Det här är nytt i Foilio",
    `<p style="line-height:1.6;color:#cbd5e1;">Hej ${name}! Vi har släppt en ny version av Foilio. Tre saker du kommer märka:</p>
     <div style="margin:20px 0 4px;">
       ${item(
         "🇯🇵 Japanska singlar",
         "Över 5 500 japanska kort från 46 set finns nu i katalogen — sök upp dem och lägg dem i samlingen precis som de engelska."
       )}
       ${item(
         "Logga in med Google eller Apple",
         "Ett tryck, inget lösenord att komma ihåg. Fungerar på webben och i appen."
       )}
       ${item(
         "Skanna utan konto",
         "Den som laddar ner appen kan prova kortskannern 10 gånger utan att skapa konto. Tipsa gärna en kompis."
       )}
     </div>
     <div style="background-color:#111827;border:1px solid #2a2e38;border-radius:10px;padding:20px;margin:24px 0 8px;">
       <p style="margin:0;line-height:1.6;color:#cbd5e1;"><strong style="color:#2dd4bf;">Har du appen?</strong> Inloggningen och gästskanningen kräver version 1.1. Har du inte automatiska uppdateringar på behöver du uppdatera själv i App Store.</p>
     </div>
     ${button(APP_STORE_URL, "Uppdatera appen")}
     <p style="line-height:1.6;color:#cbd5e1;margin:16px 0 0;">Frågor eller funderingar? Hoppa in i vår <a href="${DISCORD_URL}" style="color:#2dd4bf;font-weight:700;">Discord</a> — där svarar vi snabbast, och där släpper vi nyheterna först.</p>`,
    `Du får det här mejlet för att du har ett konto på Foilio.<br>
      <a href="${unsubscribeUrl}" style="color:#9ca3af;">Vill du inte ha nyhetsmejl? Avregistrera dig</a> &middot; dina larm och ditt veckobrev rörs inte.`
  );
  const text =
    `Hej ${name}!\n\n` +
    `Vi har släppt en ny version av Foilio. Tre saker du kommer märka:\n\n` +
    `JAPANSKA SINGLAR\n` +
    `Över 5 500 japanska kort från 46 set finns nu i katalogen — sök upp dem och lägg dem i samlingen precis som de engelska.\n\n` +
    `LOGGA IN MED GOOGLE ELLER APPLE\n` +
    `Ett tryck, inget lösenord att komma ihåg. Fungerar på webben och i appen.\n\n` +
    `SKANNA UTAN KONTO\n` +
    `Den som laddar ner appen kan prova kortskannern 10 gånger utan att skapa konto. Tipsa gärna en kompis.\n\n` +
    `Har du appen? Inloggningen och gästskanningen kräver version 1.1. Har du inte automatiska uppdateringar på behöver du uppdatera själv i App Store:\n` +
    `${APP_STORE_URL}\n\n` +
    `Frågor eller funderingar? Hoppa in i vår Discord — där svarar vi snabbast, och där släpper vi nyheterna först:\n` +
    `${DISCORD_URL}\n\n` +
    `Vill du inte ha nyhetsmejl? Avregistrera dig: ${unsubscribeUrl}\n` +
    `Dina larm och ditt veckobrev rörs inte.\n` +
    `Foilio · Sveriges marknadsplats för Pokémon TCG`;
  return { subject, html, text };
}

/**
 * MILSTOLPE + GIVEAWAY — "tack för 100 medlemmar, vi firar i Discord".
 *
 * Skickas av scripts/send-giveaway-notice.ts (förhandsgranskning till ägaren
 * först). Mejlets ENDA uppgift är att flytta folk från inkorgen in i Discord —
 * allt annat är brus och är medvetet bortskalat. Därav en knapp, inte tre.
 *
 * ⛔ **VINSTEN NÄMNS INTE, MED FLIT** (ägarbeslut 2026-09-03). Står vinsten i
 * mejlet kan mottagaren värdera erbjudandet utan att gå med, och då tappar
 * mejlet sitt syfte. Vinsten (Foilio Pro) avslöjas i servern. ⛔ Skriv därför
 * ALDRIG in den här — och ljug inte heller om att den är stor: "vad du kan
 * vinna avslöjas därinne" är nyfikenhet, "en riktig grym vinst" är ett löfte vi
 * inte kan hålla.
 *
 * ⛔ **SIFFRAN MÅSTE VARA SANN.** Mätt mot prod-DB 2026-09-03: 100 konton totalt,
 * konto nr 100 registrerades 2026-09-02, och 95 av de 100 kom den senaste
 * månaden. "Vi passerade 100 den här veckan" är alltså sant och bär ändå hela
 * tillväxtkänslan. ⛔ Skriv aldrig "100 NYA medlemmar den här veckan" — det var
 * 13, och en uppblåst siffra i ett massutskick läses av precis de människor som
 * kan räkna efter.
 *
 * ⛔ `unsubscribeUrl` ÄR OBLIGATORISK: det här är marknadsföring, inte ett
 * driftmeddelande. Typen är `news`, aldrig `weekly`.
 *
 * ⛔ EGEN INBJUDNINGSKOD (`giveawayInviteUrl()`): Discord räknar användningar per
 * kod, så utskickets effekt går att mäta gratis — utan route, utan räknare, utan
 * Neon-väckning. Delas koden med headern går det aldrig att se om mejlet levererade.
 *
 * ⛔ VILLKORSRADEN ÄR INTE PYNT: ett gratislotteri utan insats är lagligt i
 * Sverige, men dragningsdatum, "inget köp krävs" och att arrangören är Foilio
 * (inte Discord) måste stå någonstans. Den korta raden längst ner är den platsen.
 */
export function giveawayEmail(input: { name: string; unsubscribeUrl: string }): EmailContent {
  const { name, unsubscribeUrl } = input;
  /** ⛔ Dragningen står på TVÅ ställen (html + text) — ändra båda, eller ingen. */
  const drawDate = "söndag 13 september kl 20.00";
  const inviteUrl = giveawayInviteUrl();
  const subject = "Vi passerade 100 medlemmar 🎉 Kom och hämta din lott i Discord";
  const html = layout(
    "Tack – vi är 100 stycken nu 🎉",
    `<p style="line-height:1.6;color:#cbd5e1;">Hej ${name}! Den här veckan passerade Foilio <strong style="color:#ffffff;">100 medlemmar</strong> – och nästan alla har hittat hit den senaste månaden. Det gick fortare än vi vågade hoppas på, och det är din förtjänst.</p>
     <p style="line-height:1.6;color:#cbd5e1;">Så vi firar på enda rimliga sättet: <strong style="color:#ffffff;">vi lottar ut något i vår Discord.</strong></p>
     <div style="background-color:#111827;border:1px solid #2dd4bf;border-radius:10px;padding:22px;margin:24px 0;">
       <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:#2dd4bf;">Vad kan man vinna?</p>
       <p style="margin:0;line-height:1.6;color:#cbd5e1;">Det avslöjar vi inne i servern 👀 Men vi kan säga så här: den som vinner kommer använda den varje dag.</p>
     </div>
     <p style="line-height:1.6;color:#cbd5e1;margin:0 0 8px;font-weight:600;color:#ffffff;">Så här är du med:</p>
     <ol style="line-height:1.8;color:#cbd5e1;padding-left:20px;margin:0 0 4px;">
       <li>Gå med i Discord.</li>
       <li>Det var allt.</li>
     </ol>
     <p style="line-height:1.6;color:#9ca3af;font-size:14px;margin:10px 0 0;">Ingen anmälan, inget köp, inga formulär. Är du medlem när vi drar är du med. Vi drar <strong style="color:#e5e7eb;">${drawDate}</strong>.</p>
     ${button(inviteUrl, "Gå med i Discord")}
     <p style="line-height:1.6;color:#cbd5e1;margin:24px 0 8px;font-weight:600;color:#ffffff;">Och du blir kvar för det här:</p>
     <ul style="line-height:1.7;color:#cbd5e1;padding-left:20px;margin:0;">
       <li><strong style="color:#ffffff;">Restocks postas direkt</strong> – egna kanaler per serie, så du slipper bruset från set du inte samlar på.</li>
       <li><strong style="color:#ffffff;">Fråga om priser och fynd</strong> – är 900 kr rimligt för lådan? Fråga folk som köper dem varje vecka.</li>
       <li><strong style="color:#ffffff;">Nyheterna först</strong> – och saknas din butik i Foilio hamnar den ofta på listan samma vecka.</li>
     </ul>
     <p style="line-height:1.6;color:#6b7280;font-size:12px;margin:24px 0 0;">Utlottningen arrangeras av Foilio och har inget samband med Discord. Vinnaren dras slumpmässigt bland serverns medlemmar ${drawDate} och kontaktas i Discord. Inget köp krävs.</p>`,
    `Du får det här mejlet för att du har ett konto på Foilio.<br>
      <a href="${unsubscribeUrl}" style="color:#9ca3af;">Vill du inte ha nyhetsmejl? Avregistrera dig</a> &middot; dina larm och ditt veckobrev rörs inte.`
  );
  const text =
    `Hej ${name}!\n\n` +
    `Den här veckan passerade Foilio 100 medlemmar – och nästan alla har hittat hit den senaste månaden. Det gick fortare än vi vågade hoppas på, och det är din förtjänst.\n\n` +
    `Så vi firar på enda rimliga sättet: vi lottar ut något i vår Discord.\n\n` +
    `VAD KAN MAN VINNA?\n` +
    `Det avslöjar vi inne i servern. Men vi kan säga så här: den som vinner kommer använda den varje dag.\n\n` +
    `SÅ HÄR ÄR DU MED\n` +
    `1. Gå med i Discord.\n` +
    `2. Det var allt.\n\n` +
    `Ingen anmälan, inget köp, inga formulär. Är du medlem när vi drar är du med. Vi drar ${drawDate}.\n\n` +
    `Gå med här: ${inviteUrl}\n\n` +
    `OCH DU BLIR KVAR FÖR DET HÄR\n` +
    `· Restocks postas direkt – egna kanaler per serie, så du slipper bruset från set du inte samlar på.\n` +
    `· Fråga om priser och fynd – är 900 kr rimligt för lådan? Fråga folk som köper dem varje vecka.\n` +
    `· Nyheterna först – och saknas din butik i Foilio hamnar den ofta på listan samma vecka.\n\n` +
    `Utlottningen arrangeras av Foilio och har inget samband med Discord. Vinnaren dras slumpmässigt bland serverns medlemmar ${drawDate} och kontaktas i Discord. Inget köp krävs.\n\n` +
    `Vill du inte ha nyhetsmejl? Avregistrera dig: ${unsubscribeUrl}\n` +
    `Dina larm och ditt veckobrev rörs inte.\n` +
    `Foilio · Sveriges marknadsplats för Pokémon TCG`;
  return { subject, html, text };
}
