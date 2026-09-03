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
import { verifyEmail } from "@/emails/templates";
import { authError } from "@/lib/auth-errors";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim().email("Ogiltig e-postadress.") });

// Samma svar oavsett om adressen finns, är redan bekräftad eller aldrig funnits.
// Endpointen får ALDRIG gå att använda för att kartlägga vilka konton som finns.
const SUCCESS_MESSAGE = "Om adressen behöver bekräftas har vi skickat en ny länk.";

/**
 * Skickar ett nytt bekräftelsemejl.
 *
 * ⛔ VERIFIERINGSTOKEN HAR MED FLIT INGEN GILTIGHETSTID. Två konton i produktion
 * går fortfarande på tokens som skapades i juni; en utgångstid (kolumn eller
 * kontroll) hade strandat dem permanent utan att någon märkte det. Lägg inte
 * till expiry "för säkerhets skull" — token är 32 slumpade byte och nollställs
 * i samma ögonblick som den används (se /api/auth/verify).
 */
export async function POST(req: NextRequest) {
  try {
    const { ok } = await rateLimit(`resend-verify:${clientIp(req)}`, 3, 15 * 60 * 1000);
    if (!ok) {
      return NextResponse.json(
        authError("rateLimited"),
        { status: 429 }
      );
    }

    const { email } = schema.parse(await req.json());
    const normalizedEmail = email.toLowerCase();

    // Andra spärren gäller ADRESSEN, inte IP:n: utan den kan en roterande IP
    // fylla någon annans inkorg med bekräftelsemejl. Räknas före uppslaget så
    // svarstiden inte skvallrar om att kontot finns.
    const perEmail = await rateLimit(`resend-verify:mail:${normalizedEmail}`, 3, 60 * 60 * 1000);

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, name: true, email: true, emailVerifiedAt: true },
    });

    if (user && !user.emailVerifiedAt && perEmail.ok) {
      const verificationToken = crypto.randomBytes(32).toString("hex");
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const verifyUrl = `${appUrl}/verifiera?token=${verificationToken}`;

      try {
        // Skicka FÖRST, spara SEDAN. Sparar vi först och utskicket failar är den
        // gamla länken redan död och den nya nådde aldrig fram → kontot är låst
        // ute från verifiering. Med den här ordningen står den gamla länken kvar
        // som fallback tills en ny bevisligen är på väg.
        await sendMail({ to: user.email, ...verifyEmail(user.name, verifyUrl) });
        // Bara HASHEN lagras; råtoken lever enbart i verifieringslänken ovan. Se hashToken().
        await prisma.user.update({ where: { id: user.id }, data: { verificationToken: hashToken(verificationToken) } });
      } catch (mailError) {
        // Loggas högt men rapporteras inte till klienten — ett felsvar bara för
        // befintliga adresser vore precis den läcka svaret ska stoppa.
        console.error(
          `[resend-verification] Kunde inte skicka nytt bekräftelsemejl till ${user.email}:`,
          mailError
        );
      }
    }

    return jsonOk({ message: SUCCESS_MESSAGE });
  } catch (e) {
    return apiError(e);
  }
}
