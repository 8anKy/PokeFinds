import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";

export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().min(1, "Token saknas."),
  password: z.string().min(8, "Lösenordet måste vara minst 8 tecken.").max(128),
});

export async function POST(req: Request) {
  try {
    const { token, password } = schema.parse(await req.json());

    const user = await prisma.user.findUnique({ where: { resetToken: token } });
    if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
      return NextResponse.json(
        { error: "Länken är ogiltig eller har gått ut. Begär en ny återställningslänk." },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExpiresAt: null },
    });

    return jsonOk({ message: "Ditt lösenord har uppdaterats. Du kan nu logga in." });
  } catch (e) {
    return apiError(e);
  }
}
