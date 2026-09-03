import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { apiError, jsonOk } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { interpretResendEvent, type MailDeliveryStatus } from "@/lib/mail-status";
import { authError } from "@/lib/auth-errors";

export const dynamic = "force-dynamic";

/**
 * "Kom kodmejlet fram?" — frågar Resend om ETT meddelande-id.
 *
 * Finns för att en feltypad adress annars är en tyst återvändsgränd: koden
 * studsar, och den som väntar ser bara ett kodfält som aldrig kan fyllas.
 * Klienten pollar några gånger medan kodsteget är öppet och byter till ett
 * besked om att adressen inte gick att nå.
 *
 * ⛔ RÖR ALDRIG DATABASEN. Id:t kommer från klienten (det returnerades till
 * just den här besökaren av send-code), så pollningen är ren HTTP mot Resend
 * och väcker inte Neon — som debiteras per VAKEN TID, minst 300 s per väckning.
 * Samma skäl som restock-lanens källcache. Det är också därför id:t INTE
 * sparas i SignupVerification: en kolumn hade krävt en läsning per poll.
 * ⛔ Svaret säger BARA leveransstatus — aldrig adress, ämne eller innehåll.
 * Resends svar bär hela mejlet, och det ska inte läcka vidare till klienten.
 */
export async function GET(req: NextRequest) {
  try {
    // Id:t är en ogissbar UUID, men taket finns ändå: utan det kan en läckt
    // eller gissad id-lista pollas hur hårt som helst mot vår Resend-kvot.
    const { ok } = await rateLimit(`register-mailstatus:${clientIp(req)}`, 40, 15 * 60 * 1000);
    if (!ok) {
      return NextResponse.json(authError("tooManyRequests"), { status: 429 });
    }

    const id = req.nextUrl.searchParams.get("id");
    // Formvakt: bara Resends egna id:n släpps vidare, så parametern aldrig kan
    // bli en väg att peka våra anrop mot en annan sökväg hos Resend.
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json(authError("invalidId"), { status: 400 });
    }

    const key = process.env.RESEND_API_KEY;
    // Ingen nyckel (konsolläge/dev) → vi VET ingenting. "pending" är rätt svar:
    // klienten säger då heller ingenting, i stället för att påstå en leverans.
    if (!key) return jsonOk({ status: "pending" satisfies MailDeliveryStatus });

    const res = await fetch(`https://api.resend.com/emails/${id}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    // ⛔ Allt annat än 200 är "vet inte" — ALDRIG en studs. Ett 404 (id:t har
    // hunnit rensas) eller ett 429 får inte läsa som att adressen är fel.
    if (!res.ok) return jsonOk({ status: "pending" satisfies MailDeliveryStatus });

    const body = (await res.json()) as { last_event?: unknown };
    return jsonOk({ status: interpretResendEvent(body.last_event) });
  } catch (e) {
    return apiError(e);
  }
}
