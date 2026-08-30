/**
 * AVREGISTRERING FRÅN VECKOBREVET — fungerar UTLOGGAD.
 *
 * Två ingångar, med flit:
 *  - **POST** = ett-klicks-avanmälan (RFC 8058). Gmail/Outlook POST:ar hit direkt
 *    från sin egen knapp, utan att mottagaren öppnat mejlet. Se `List-Unsubscribe`
 *    i src/lib/mailer.ts.
 *  - **GET** = länken i brevets sidfot. ⛔ GET ÄNDRAR INGENTING: mejlklienter och
 *    säkerhetsskannrar FÖRHÄMTAR länkar i inkorgen, och en GET som avregistrerar
 *    hade tystat användare som aldrig klickat — ett tyst bortfall vi inte kan
 *    upptäcka. GET renderar därför en knapp som POST:ar.
 *
 * ⛔ EN ROUTE-HANDLER, INTE EN NEXT-SIDA. Sidan måste svara identiskt för utloggade,
 *    ligga utanför locale-routingen och aldrig kunna dras in i den ISR-cachade
 *    chrome:n (som inte får röra `auth()`/`cookies()`). En självständig HTML-sträng
 *    här har inga sådana beroenden alls.
 *
 * ⛔ SVARET ÄR DETSAMMA FÖR EN GILTIG OCH EN FÖRFALSKAD TOKEN. Samma
 *    kartläggningsregel som /glomt-losenord: ingenting får avslöja om ett konto
 *    finns. En ogiltig token når dessutom aldrig databasen — signaturen prövas
 *    först, så en flod av gissningar kostar noll Neon-tid.
 */
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { verifyUnsubscribeToken, type UnsubscribeType } from "@/lib/unsubscribe-token";
import { parseNotificationSettings } from "@/lib/notification-settings";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://foilio.se";

/** Minimal, självbärande sida i appens färger (svart yta, turkos accent). */
function page(title: string, body: string, status = 200): Response {
  const html = `<!DOCTYPE html>
<html lang="sv">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Foilio</title></head>
<body style="margin:0;background-color:#0f1115;font-family:'Segoe UI',Arial,sans-serif;color:#e5e7eb;">
  <div style="max-width:520px;margin:0 auto;padding:48px 20px;">
    <div style="background-color:#1a1d24;border:1px solid #2a2e38;border-radius:12px;padding:32px 28px;">
      <h1 style="margin:0 0 16px;font-size:20px;color:#ffffff;">${title}</h1>
      ${body}
    </div>
    <p style="text-align:center;padding-top:24px;font-size:12px;color:#6b7280;">
      Foilio · Sveriges marknadsplats för Pokémon TCG
    </p>
  </div>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * Copy per utskickstyp. Typens namn ÄR nyckeln i `notificationSettings` som slås
 * av (`weekly`, `news`) — håll dem lika, det är vad `unsubscribe()` bygger på.
 */
const KINDS: Record<UnsubscribeType, { what: string; title: string; keeps: string; resume: string }> = {
  weekly: {
    what: "Foilios veckobrev",
    title: "veckobrevet",
    keeps: "Dina prislarm och restock-larm rörs inte — de är en egen inställning.",
    resume: "veckobrevet",
  },
  news: {
    what: "Foilios nyhetsmejl",
    title: "nyhetsmejlen",
    keeps: "Dina larm och ditt veckobrev rörs inte — de är egna inställningar.",
    resume: "nyhetsmejlen",
  },
};

/**
 * Typen ur tokenens första segment, UTAN verifiering — bara för att välja copy.
 * En förfalskad token får alltså samma sida som en äkta av samma typ, och ett
 * okänt prefix faller till veckobrevet. Ingenting här rör databasen.
 */
function kindOf(token: string | null | undefined): UnsubscribeType {
  const head = (token ?? "").split(".")[0];
  return head === "news" ? "news" : "weekly";
}

function doneBody(type: UnsubscribeType): string {
  const k = KINDS[type];
  return `<p style="line-height:1.6;color:#cbd5e1;">Du får inga fler ${k.what.replace("Foilios ", "")} från Foilio. ${k.keeps}</p>
     <p style="line-height:1.6;color:#cbd5e1;">Ångrar du dig slår du på ${k.resume} igen under Inställningar i appen.</p>
     <p style="margin:24px 0 0;"><a href="${APP_URL}/installningar" style="display:inline-block;background-color:#2dd4bf;color:#08110f;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:8px;">Öppna inställningar</a></p>`;
}

/** Slår av typens nyckel utan att röra övriga nycklar i JSON-kolumnen. */
async function unsubscribe(userId: string, type: UnsubscribeType): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationSettings: true },
  });
  // Kontot kan ha raderats sedan brevet skickades — då finns inget att göra, och
  // svaret ska ändå se likadant ut.
  if (!user) return;
  const existing = (user.notificationSettings ?? {}) as Record<string, unknown>;
  await prisma.user.update({
    where: { id: userId },
    data: {
      notificationSettings: { ...existing, [type]: false } as Prisma.InputJsonValue,
    },
  });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const k = KINDS[kindOf(token)];
  // Bekräftelsesteg — inte för att vi tvivlar på mottagaren, utan för att
  // förhämtningen i inkorgen inte ska avregistrera någon som aldrig klickade.
  const body = `<p style="line-height:1.6;color:#cbd5e1;">Vill du sluta få ${k.what}? ${k.keeps}</p>
     <form method="post" action="/api/unsubscribe">
       <input type="hidden" name="token" value="${token.replace(/"/g, "&quot;")}">
       <button type="submit" style="margin-top:16px;background-color:#2dd4bf;color:#08110f;border:0;font-weight:700;font-size:15px;padding:12px 24px;border-radius:8px;cursor:pointer;">Ja, avregistrera mig</button>
     </form>
     <p style="line-height:1.6;color:#6b7280;font-size:13px;margin-top:20px;">Vill du behålla ${k.title} behöver du inte göra något alls — stäng bara den här sidan.</p>`;
  return page(`Avregistrera från ${k.title}`, body);
}

export async function POST(req: NextRequest) {
  // Token kan komma från query (mejlklientens ett-klicks-POST går på URL:en) eller
  // från formuläret ovan. Query vinner — den är den signerade länken vi själva
  // skrev in i brevet.
  let token = req.nextUrl.searchParams.get("token");
  if (!token) {
    // Bara formulärposten har en kropp värd att läsa. Ett trasigt/tomt body får
    // aldrig ge 500 — det ska falla ut som "ogiltig token", dvs samma svar som allt annat.
    try {
      const form = await req.formData();
      const value = form.get("token");
      if (typeof value === "string") token = value;
    } catch {
      token = null;
    }
  }

  const claim = verifyUnsubscribeToken(token);
  if (claim) {
    try {
      await unsubscribe(claim.userId, claim.type);
    } catch (e) {
      // ⛔ HÄR LJUGER VI INTE. "Klart, du är avregistrerad" när skrivningen
      // misslyckades betyder att nästa veckobrev kommer ändå — och då är
      // spamknappen mottagarens enda kvarvarande utväg, vilket kostar
      // avsändarryktet långt mer än en ärlig felsida gör. 503 + samma knapp igen.
      console.error("[unsubscribe] Kunde inte spara avregistreringen:", e);
      return page(
        "Det gick inte just nu",
        `<p style="line-height:1.6;color:#cbd5e1;">Något gick fel på vår sida. Försök igen om en liten stund — knappen fungerar lika bra då.</p>
     <form method="post" action="/api/unsubscribe">
       <input type="hidden" name="token" value="${(token ?? "").replace(/"/g, "&quot;")}">
       <button type="submit" style="margin-top:16px;background-color:#2dd4bf;color:#08110f;border:0;font-weight:700;font-size:15px;padding:12px 24px;border-radius:8px;cursor:pointer;">Försök igen</button>
     </form>`,
        503
      );
    }
  }
  // Samma svar för giltig och förfalskad token — se kartläggningsregeln i filens topp.
  // Copyn väljs på tokenens (overifierade) prefix, inte på `claim`, av samma skäl.
  return page("Klart — du är avregistrerad", doneBody(kindOf(token)));
}
