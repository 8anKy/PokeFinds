import crypto from "crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { sendMail } from "@/lib/mailer";
import { welcomeEmail, verifyEmail } from "@/emails/templates";
import { redeemInviteAtRegistration } from "@/services/invites";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(2, "Namnet måste vara minst 2 tecken.").max(80),
  email: z.string().trim().email("Ogiltig e-postadress."),
  password: z.string().min(8, "Lösenordet måste vara minst 8 tecken.").max(128),
  // Inbjudningskod (#10) — valfri; ogiltig/använd kod ignoreras tyst
  // (registreringen ska aldrig stoppas av en dålig kod).
  invite: z.string().trim().max(64).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
    const { ok } = await rateLimit(`register:${ip}`, 5, 15 * 60 * 1000);
    if (!ok) {
      return NextResponse.json(
        { error: "För många försök. Vänta en stund och försök igen." },
        { status: 429 }
      );
    }

    const { name, email, password, invite } = schema.parse(await req.json());
    const normalizedEmail = email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return NextResponse.json(
        { error: "Du har redan ett konto med den här e-postadressen – logga in istället." },
        { status: 409 }
      );
    }

    const nameTaken = await prisma.user.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (nameTaken) {
      return NextResponse.json(
        { error: "Användarnamnet är upptaget. Välj ett annat." },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString("hex");

    const user = await prisma.user.create({
      data: { name, email: normalizedEmail, passwordHash, verificationToken },
      select: { id: true, name: true, email: true },
    });

    // Inbjudan (#10): förbruka koden mot det NYA kontot (registrering är enda
    // inlösningsvägen). Engångs + atomär i redeemInviteAtRegistration.
    if (invite) await redeemInviteAtRegistration(invite, user.id);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const verifyUrl = `${appUrl}/verifiera?token=${verificationToken}`;

    // E-postfel ska inte stoppa registreringen — kontot finns och behålls.
    // ⛔ De två mejlen delade förr ETT try-block med välkomstmejlet FÖRST: föll
    // det (och det är det kosmetiska av de två) hoppades verifieringsmejlet över
    // helt, medan svaret ändå sa "kolla din inkorg". Verifieringen skickas därför
    // FÖRST och OBEROENDE, och dess utfall styr vad vi påstår i svaret.
    let verificationSent = true;
    try {
      await sendMail({ to: user.email, ...verifyEmail(user.name, verifyUrl) });
    } catch (mailError) {
      verificationSent = false;
      console.error(
        `[register] Verifieringsmejlet till ${user.email} gick inte att skicka:`,
        mailError
      );
    }

    // Välkomstmejlet är trevligt, inte funktionellt: eget try, påverkar inte svaret.
    try {
      await sendMail({ to: user.email, ...welcomeEmail(user.name) });
    } catch (mailError) {
      console.error(`[register] Välkomstmejlet till ${user.email} gick inte att skicka:`, mailError);
    }

    // Ärligt svar: be aldrig någon kolla en inkorg som aldrig får något.
    return jsonOk(
      {
        message: verificationSent
          ? "Kontot har skapats. Kolla din inkorg för att bekräfta din e-postadress."
          : "Kontot har skapats, men bekräftelsemejlet fastnade på vägen. Använd “Skicka igen” i påminnelsen högst upp i appen när du är inloggad.",
        verificationEmailSent: verificationSent,
      },
      { status: 201 }
    );
  } catch (e) {
    return apiError(e);
  }
}
