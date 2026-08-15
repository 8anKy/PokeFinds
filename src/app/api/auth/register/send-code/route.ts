import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { sendMail } from "@/lib/mailer";
import { signupCodeEmail } from "@/emails/templates";
import { generateSignupCode, hashSignupCode, SIGNUP_CODE_TTL_MS } from "@/lib/signup-code";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().email("Ogiltig e-postadress."),
  // Namnet valideras REDAN HÄR (inte bara i /register): ett upptaget namn ska
  // stoppa användaren vid "Skicka kod", inte efter att koden hämtats ur inkorgen.
  name: z.string().trim().min(2, "Namnet måste vara minst 2 tecken.").max(80),
});

/**
 * Steg 1 i registreringen: mejlar en 6-siffrig kod som bevisar att adressen är
 * användarens egen. Kontot skapas först när koden anges i /api/auth/register.
 *
 * Svar med `field` ("name"/"email") låter klienten fästa felet vid rätt fält.
 * Ordningen är medveten: namn- och adresskollarna ligger FÖRE per-adress-
 * spärren, så att den som rättar ett upptaget namn inte bränner sina tre
 * kodutskick per timme på försök som aldrig skickade något.
 */
export async function POST(req: NextRequest) {
  try {
    const { ok } = await rateLimit(`register-code:${clientIp(req)}`, 5, 15 * 60 * 1000);
    if (!ok) {
      return NextResponse.json(
        { error: "För många försök. Vänta en stund och försök igen." },
        { status: 429 }
      );
    }

    const { email, name } = schema.parse(await req.json());
    const normalizedEmail = email.toLowerCase();

    // Samma kontroll (och besked) som /register — den är fortfarande facit vid
    // själva skapandet; det här är samma dom, bara tidigare.
    const nameTaken = await prisma.user.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (nameTaken) {
      return NextResponse.json(
        { error: "Användarnamnet är upptaget. Välj ett annat.", field: "name" },
        { status: 409 }
      );
    }

    // Samma besked som registreringen själv ger på en upptagen adress — ingen NY
    // kartläggningsyta (POST /register svarar redan 409 där), och den som redan
    // har ett konto ska logga in, inte vänta på en kod som ändå inte kan användas.
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        {
          error: "Du har redan ett konto med den här e-postadressen – logga in istället.",
          field: "email",
        },
        { status: 409 }
      );
    }

    // Adress-spärr utöver IP-spärren: utan den kan en roterande IP fylla någon
    // annans inkorg med koder. Räknas bara på försök som annars hade SKICKAT.
    const perEmail = await rateLimit(`register-code:mail:${normalizedEmail}`, 3, 60 * 60 * 1000);
    if (!perEmail.ok) {
      return NextResponse.json(
        { error: "Vi har redan skickat flera koder till den adressen. Vänta en stund och försök igen." },
        { status: 429 }
      );
    }

    const code = generateSignupCode();

    // Skicka FÖRST, spara SEDAN (samma ordning som resend-verification): failar
    // utskicket står en eventuell äldre kod kvar som giltig, och svaret säger
    // sanningen i stället för att be någon leta efter ett mejl som aldrig gick.
    // Meddelande-id:t går tillbaka till klienten, som pollar /mail-status med det
    // medan kodsteget är öppet. En feltypad adress (ett fel i lokaldelen går inte
    // att gissa i förväg) blir annars en TYST återvändsgränd: mejlet studsar, och
    // den som väntar ser bara ett kodfält som aldrig kan fyllas.
    let mailId: string | undefined;
    try {
      const sent = await sendMail({
        to: normalizedEmail,
        ...signupCodeEmail(code, SIGNUP_CODE_TTL_MS),
      });
      mailId = sent.id;
    } catch (mailError) {
      console.error(
        `[register/send-code] Koden till ${normalizedEmail} gick inte att skicka:`,
        mailError
      );
      return NextResponse.json(
        { error: "Mejlet gick inte att skicka just nu. Försök igen om en liten stund." },
        { status: 502 }
      );
    }

    await prisma.signupVerification.upsert({
      where: { email: normalizedEmail },
      create: {
        email: normalizedEmail,
        codeHash: hashSignupCode(code),
        expiresAt: new Date(Date.now() + SIGNUP_CODE_TTL_MS),
      },
      // Ny kod ersätter den gamla helt — inklusive attempts, annars ärver en
      // färsk kod den gamla kodens fellåsning.
      update: {
        codeHash: hashSignupCode(code),
        expiresAt: new Date(Date.now() + SIGNUP_CODE_TTL_MS),
        attempts: 0,
      },
    });

    return jsonOk({ message: "Vi har mejlat en kod till din adress.", mailId });
  } catch (e) {
    return apiError(e);
  }
}
