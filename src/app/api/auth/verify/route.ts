import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { creditInviteOnVerify } from "@/services/invites";

export const dynamic = "force-dynamic";

const schema = z.object({ token: z.string().min(1, "Token saknas.") });

export async function POST(req: Request) {
  try {
    const { token } = schema.parse(await req.json());

    const user = await prisma.user.findUnique({ where: { verificationToken: token } });
    if (!user) {
      return NextResponse.json(
        { error: "Ogiltig eller redan använd verifieringslänk." },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), verificationToken: null },
    });

    // Inbjudan (#10): kom användaren hit via en väns kod räknas verifieringen
    // mot vännens belöning (3 verifierade → 1 månad Pro). Får aldrig fälla
    // verifieringen — belöningen är en bieffekt.
    try {
      await creditInviteOnVerify(user.id);
    } catch (e) {
      console.error("creditInviteOnVerify misslyckades:", e);
    }

    return jsonOk({ message: "Din e-postadress är nu bekräftad. Välkommen till Foilio!" });
  } catch (e) {
    return apiError(e);
  }
}
