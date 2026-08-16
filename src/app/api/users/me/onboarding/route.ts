import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser, AuthError } from "@/lib/auth";

export const dynamic = "force-dynamic";

/*
 * ⛔ `budget` och `interests` ÄR BORTA (2026-08-16) — fälten skrevs till
 * `preferences` och lästes av ingen kod. De togs bort ur klienten och HÄR i
 * samma ändring: hade schemat behållit `budget: z.enum(...)` (obligatoriskt)
 * hade en klient utan fältet fått 400 och HELA onboardingen dött för varje nytt
 * konto. Objektet är icke-strikt, så en gammal cachad klient som fortfarande
 * skickar fälten får dem tyst bortsållade i stället för ett fel.
 *
 * Gamla `preferences`-rader behåller sina döda fält (vi spridar in `...existingPrefs`
 * och städar inte) — `favoriteSetIds()` bryr sig bara om `favoriteSets`.
 */
const schema = z.object({
  favoriteSets: z.array(z.string()).max(50).default([]),
  notificationSettings: z
    .object({
      email: z.boolean().optional(),
      push: z.boolean().optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
  try {
    const sessionUser = await requireUser();
    const input = schema.parse(await req.json());

    const current = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: { preferences: true, notificationSettings: true },
    });
    if (!current) throw new AuthError(404, "Användaren hittades inte.");

    const existingPrefs = (current.preferences ?? {}) as Record<string, unknown>;
    const existingNotif = (current.notificationSettings ?? {}) as Record<string, unknown>;

    const user = await prisma.user.update({
      where: { id: sessionUser.id },
      data: {
        onboardingCompleted: true,
        preferences: {
          ...existingPrefs,
          favoriteSets: input.favoriteSets,
        } as Prisma.InputJsonValue,
        notificationSettings: {
          ...existingNotif,
          ...(input.notificationSettings ?? {}),
        } as Prisma.InputJsonValue,
      },
      select: { id: true, onboardingCompleted: true, preferences: true, notificationSettings: true },
    });

    return jsonOk({ message: "Onboarding klar. Välkommen till Foilio!", user });
  } catch (e) {
    return apiError(e);
  }
}
