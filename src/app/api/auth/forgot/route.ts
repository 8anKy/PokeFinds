import crypto from "crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { hashToken } from "@/lib/tokens";
import { sendMail } from "@/lib/mailer";
import { passwordResetEmail } from "@/emails/templates";
import { authError } from "@/lib/auth-errors";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim().email("Ogiltig e-postadress.") });

const SUCCESS_MESSAGE = "Om kontot finns skickar vi en återställningslänk.";

export async function POST(req: NextRequest) {
  try {
    const { ok } = await rateLimit(`forgot:${clientIp(req)}`, 3, 15 * 60 * 1000);
    if (!ok) {
      return NextResponse.json(
        authError("rateLimited"),
        { status: 429 }
      );
    }

    const { email } = schema.parse(await req.json());
    const normalizedEmail = email.toLowerCase();

    // Andra spärren gäller ADRESSEN, inte IP:n (samma mönster som resend-verification):
    // utan den kan en roterande IP fylla någon annans inkorg med återställningsmejl.
    // Räknas före uppslaget så svarstiden inte skvallrar om att kontot finns.
    const perEmail = await rateLimit(`forgot:mail:${normalizedEmail}`, 3, 60 * 60 * 1000);

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (user && perEmail.ok) {
      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 timme

      await prisma.user.update({
        where: { id: user.id },
        // Bara HASHEN lagras; råtoken lever enbart i mejllänken nedan. Se hashToken().
        data: { resetToken: hashToken(resetToken), resetTokenExpiresAt },
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
