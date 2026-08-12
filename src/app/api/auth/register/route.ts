import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { sendMail } from "@/lib/mailer";
import { welcomeEmail } from "@/emails/templates";
import { redeemInviteAtRegistration, creditInviteOnVerify } from "@/services/invites";
import { evaluateSignupCode, type SignupCodeVerdict } from "@/lib/signup-code";
import { CREATOR_REF_COOKIE } from "@/lib/creator-ref";
import { resolveCreatorCode } from "@/services/creator-codes";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(2, "Namnet måste vara minst 2 tecken.").max(80),
  email: z.string().trim().email("Ogiltig e-postadress."),
  password: z.string().min(8, "Lösenordet måste vara minst 8 tecken.").max(128),
  // Koden från "Skicka kod"-steget (/api/auth/register/send-code) — beviset på
  // att adressen är användarens egen. Utan giltig kod skapas inget konto.
  code: z.string().trim().regex(/^\d{6}$/, "Ange den 6-siffriga koden från mejlet."),
  // Inbjudningskod (#10) — valfri; ogiltig/använd kod ignoreras tyst
  // (registreringen ska aldrig stoppas av en dålig kod).
  invite: z.string().trim().max(64).optional(),
});

const CODE_ERRORS: Record<Exclude<SignupCodeVerdict, "ok">, string> = {
  missing: "Ingen kod är utfärdad för den här adressen. Tryck på ”Skicka kod” först.",
  expired: "Koden har gått ut. Begär en ny kod.",
  locked: "För många felaktiga försök. Begär en ny kod.",
  wrong: "Fel kod. Kontrollera mejlet och försök igen.",
};

export async function POST(req: NextRequest) {
  try {
    const { ok } = await rateLimit(`register:${clientIp(req)}`, 5, 15 * 60 * 1000);
    if (!ok) {
      return NextResponse.json(
        { error: "För många försök. Vänta en stund och försök igen." },
        { status: 429 }
      );
    }

    const { name, email, password, code, invite } = schema.parse(await req.json());
    const normalizedEmail = email.toLowerCase();

    // `field` låter klienten fästa felet vid rätt fält. Send-code gör samma
    // kontroller FÖRE koden skickas — de här är facit vid skapandet och fångar
    // bara racet där namnet/adressen togs mellan kodutskicket och submit.
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return NextResponse.json(
        {
          error: "Du har redan ett konto med den här e-postadressen – logga in istället.",
          field: "email",
        },
        { status: 409 }
      );
    }

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

    // E-postägarskapet bevisas FÖRE kontot skapas. Koden kontrolleras EFTER
    // namn-/adresskollarna ovan så att ett upptaget namn inte bränner ett av
    // kodens fem försök; den förbrukas (raderas) först när kontot faktiskt
    // skapats, så användaren kan rätta andra fält utan att begära ny kod.
    const verification = await prisma.signupVerification.findUnique({
      where: { email: normalizedEmail },
    });
    const verdict = evaluateSignupCode(verification, code, new Date());
    if (verdict !== "ok") {
      if (verdict === "wrong") {
        await prisma.signupVerification.update({
          where: { email: normalizedEmail },
          data: { attempts: { increment: 1 } },
        });
      }
      return NextResponse.json({ error: CODE_ERRORS[verdict] }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Kreatörsattribution: koden kommer från `fo_ref`-cookien som middleware satte
    // när besökaren klickade på kreatörens `?ref=`-länk (upp till 30 dygn sedan).
    // Läses SERVER-side ur cookien, aldrig ur klientens body — annars kan vilken
    // POST som helst tillskriva sig ett konto och kreatörsutbetalningarna blir
    // fritt redigerbara. Okänd/avstängd kod ⇒ null ⇒ kontot skapas som organiskt.
    const creatorCode = await resolveCreatorCode(req.cookies.get(CREATOR_REF_COOKIE)?.value);

    // Koden ÄR bekräftelsen → kontot föds verifierat. Länk-flödet
    // (verificationToken + /verifiera) finns kvar enbart för gamla konton.
    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        passwordHash,
        emailVerifiedAt: new Date(),
        creatorCodeId: creatorCode?.id ?? null,
        attributedAt: creatorCode ? new Date() : null,
      },
      select: { id: true, name: true, email: true },
    });

    // Förbrukad — deleteMany är idempotent om två flikar tävlade (unikt e-post-
    // index på User avgjorde redan vinnaren ovan).
    await prisma.signupVerification.deleteMany({ where: { email: normalizedEmail } });

    // Inbjudan (#10): förbruka koden mot det NYA kontot (registrering är enda
    // inlösningsvägen). Engångs + atomär i redeemInviteAtRegistration. Kontot
    // föds bekräftat, så vännens belöning krediteras direkt — nya konton når
    // aldrig /api/auth/verify, som var den gamla krediteringspunkten.
    if (invite) {
      await redeemInviteAtRegistration(invite, user.id);
      try {
        await creditInviteOnVerify(user.id);
      } catch (e) {
        console.error("creditInviteOnVerify misslyckades:", e);
      }
    }

    // Välkomstmejlet är trevligt, inte funktionellt: eget try, påverkar inte svaret.
    try {
      await sendMail({ to: user.email, ...welcomeEmail(user.name) });
    } catch (mailError) {
      console.error(`[register] Välkomstmejlet till ${user.email} gick inte att skicka:`, mailError);
    }

    return jsonOk({ message: "Kontot har skapats. Välkommen till Foilio!" }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
