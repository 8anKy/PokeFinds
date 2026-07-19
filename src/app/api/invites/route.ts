/**
 * Inbjudningar (#10). GET = min översikt (koder, status, framsteg mot nästa
 * belöning, bonus-t.o.m.). POST = skapa ny engångskod (kapad mot spam).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError, jsonOk } from "@/lib/api";
import { createInvite, getInviteStatus } from "@/services/invites";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    return jsonOk(await getInviteStatus(user.id));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST() {
  try {
    const user = await requireUser();
    const res = await createInvite(user.id);
    if ("error" in res) {
      return NextResponse.json(
        res.error === "earned"
          ? { error: "Du har redan tagit ut din inbjudningsbelöning." }
          : { error: "Du har för många oanvända inbjudningar. Dela dem du redan skapat först." },
        { status: res.error === "earned" ? 403 : 429 }
      );
    }
    return jsonOk({ code: res.code }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
