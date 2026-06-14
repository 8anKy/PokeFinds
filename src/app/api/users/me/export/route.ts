import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiError } from "@/lib/api";
import { requireUser, AuthError } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GDPR-export: all användardata som nedladdningsbar JSON. */
export async function GET() {
  try {
    const sessionUser = await requireUser();

    const user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: {
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
        updatedAt: true,
        watchlistItems: {
          include: { product: { select: { title: true, slug: true } } },
        },
        collectionItems: {
          include: {
            card: { select: { name: true, number: true } },
            product: { select: { title: true } },
          },
        },
        posts: true,
        comments: true,
        alerts: true,
      },
    });
    if (!user) throw new AuthError(404, "Användaren hittades inte.");

    const exportData = {
      exportedAt: new Date().toISOString(),
      service: "PokeFinds",
      description: "GDPR-dataexport. All data kopplad till ditt konto.",
      profile: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        planTier: user.planTier,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        emailVerifiedAt: user.emailVerifiedAt,
        onboardingCompleted: user.onboardingCompleted,
        notificationSettings: user.notificationSettings,
        preferences: user.preferences,
        reputationScore: user.reputationScore,
        isPublicCollection: user.isPublicCollection,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      watchlist: user.watchlistItems,
      collection: user.collectionItems,
      posts: user.posts,
      comments: user.comments,
      alerts: user.alerts,
    };

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="pokefinds-data.json"',
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
