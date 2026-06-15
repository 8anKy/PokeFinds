import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser, AuthError } from "@/lib/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  favoriteSets: z.array(z.string()).max(50).default([]),
  budget: z.enum(["low", "medium", "high"]),
  interests: z.array(z.string()).max(20).default([]),
  notificationSettings: z
    .object({
      email: z.boolean().optional(),
      inApp: z.boolean().optional(),
      push: z.boolean().optional(),
      weeklyReport: z.boolean().optional(),
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
          budget: input.budget,
          interests: input.interests,
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
