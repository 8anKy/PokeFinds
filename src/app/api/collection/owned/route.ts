/**
 * GET /api/collection/owned?productId=… — hur många av JUST den här produkten den
 * inloggade redan har, per skick/gradering/pärm (tilläggsarkets "Du har redan …",
 * designpasset 2026-10-25). En smal fråga på (userId, productId) — anropas bara när
 * arket öppnas, aldrig per kort i ett rutnät. ⛔ `private, no-store`: per person.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const querySchema = z.object({ productId: z.string().min(1).max(64) });

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const { productId } = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const rows = await prisma.collectionItem.findMany({
      where: { userId: user.id, productId },
      select: { quantity: true, condition: true, gradingCompany: true, grade: true, portfolioId: true },
    });
    // Samma kort i samma skick/gradering/pärm är EN grupp även om det ligger i flera lots.
    const groups = new Map<
      string,
      { quantity: number; condition: string; gradingCompany: string | null; grade: string | null; portfolioId: string | null }
    >();
    for (const r of rows) {
      const key = [r.condition, r.gradingCompany ?? "", r.grade ?? "", r.portfolioId ?? ""].join("|");
      const g = groups.get(key);
      if (g) g.quantity += r.quantity;
      else groups.set(key, { ...r });
    }
    const list = [...groups.values()].sort((a, b) => b.quantity - a.quantity);
    return NextResponse.json(
      { total: list.reduce((s, g) => s + g.quantity, 0), groups: list },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e) {
    return apiError(e);
  }
}
