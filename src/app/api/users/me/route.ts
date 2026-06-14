import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser, AuthError } from "@/lib/auth";

export const dynamic = "force-dynamic";

const profileSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  planTier: true,
  avatarUrl: true,
  bio: true,
  emailVerifiedAt: true,
  onboardingCompleted: true,
  notificationSettings: true,
  preferences: true,
  reputationScore: true,
  isPublicCollection: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const notificationSettingsSchema = z.object({
  email: z.boolean().optional(),
  inApp: z.boolean().optional(),
  push: z.boolean().optional(),
  weeklyReport: z.boolean().optional(),
});

const patchSchema = z.object({
  name: z.string().trim().min(2, "Namnet måste vara minst 2 tecken.").max(80).optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  notificationSettings: notificationSettingsSchema.optional(),
  preferences: z.record(z.unknown()).optional(),
  isPublicCollection: z.boolean().optional(),
});

export async function GET() {
  try {
    const sessionUser = await requireUser();
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: profileSelect,
    });
    if (!user) throw new AuthError(404, "Användaren hittades inte.");
    return jsonOk(user);
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const sessionUser = await requireUser();
    const input = patchSchema.parse(await req.json());

    const current = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: { notificationSettings: true, preferences: true },
    });
    if (!current) throw new AuthError(404, "Användaren hittades inte.");

    const data: Prisma.UserUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.bio !== undefined) data.bio = input.bio;
    if (input.isPublicCollection !== undefined) data.isPublicCollection = input.isPublicCollection;
    if (input.notificationSettings !== undefined) {
      const existing = (current.notificationSettings ?? {}) as Record<string, unknown>;
      data.notificationSettings = {
        ...existing,
        ...input.notificationSettings,
      } as Prisma.InputJsonValue;
    }
    if (input.preferences !== undefined) {
      const existing = (current.preferences ?? {}) as Record<string, unknown>;
      data.preferences = { ...existing, ...input.preferences } as Prisma.InputJsonValue;
    }

    const user = await prisma.user.update({
      where: { id: sessionUser.id },
      data,
      select: profileSelect,
    });

    return jsonOk(user);
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE() {
  try {
    const sessionUser = await requireUser();
    // GDPR: radera kontot. Relationer hanteras via onDelete: Cascade i schemat.
    await prisma.user.delete({ where: { id: sessionUser.id } });
    return jsonOk({ message: "Ditt konto och all din data har raderats." });
  } catch (e) {
    return apiError(e);
  }
}
