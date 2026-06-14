import crypto from "crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { sendMail } from "@/lib/mailer";
import { passwordResetEmail } from "@/emails/templates";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim().email("Ogiltig e-postadress.") });

const SUCCESS_MESSAGE = "Om kontot finns skickar vi en återställningslänk.";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
    const { ok } = await rateLimit(`forgot:${ip}`, 3, 15 * 60 * 1000);
    if (!ok) {
      return NextResponse.json(
        { error: "För många försök. Vänta en stund och försök igen." },
        { status: 429 }
      );
    }

    const { email } = schema.parse(await req.json());
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    if (user) {
      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 timme

      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken, resetTokenExpiresAt },
      });

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const resetUrl = `${appUrl}/aterstall-losenord?token=${resetToken}`;

      try {
        await sendMail({ to: user.email, ...passwordResetEmail(user.name, resetUrl) });
      } catch (mailError) {
        console.error("Kunde inte skicka återställningsmejl:", mailError);
      }
    }

    // Avslöja aldrig om kontot finns
    return jsonOk({ message: SUCCESS_MESSAGE });
  } catch (e) {
    return apiError(e);
  }
}
