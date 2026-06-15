import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";

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

    return jsonOk({ message: "Din e-postadress är nu bekräftad. Välkommen till Foilio!" });
  } catch (e) {
    return apiError(e);
  }
}
