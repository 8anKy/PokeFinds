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
        // Pro-källor bortom planTier — bådadera personuppgifter om kontots status.
        bonusProUntil: true,
        stripeProUntil: true,
        avatarUrl: true,
        bio: true,
        emailVerifiedAt: true,
        onboardingCompleted: true,
        notificationSettings: true,
        preferences: true,
        reputationScore: true,
        isPublicCollection: true,
        lastPushError: true,
        traderaTokenExpiresAt: true,
        // Kopplade konton. ⛔ Den här routen använder en EXPLICIT select, så en ny
        // kolumn hamnar aldrig i exporten av sig själv — den måste läggas till här
        // också, annars är exporten tyst ofullständig (art. 15/20).
        // traderaUserId saknades här sedan kopplingen byggdes; rättat 2026-08-07.
        traderaUserId: true,
        discordUserId: true,
        discordUsername: true,
        discordLinkedAt: true,
        // Google-/Apple-inloggning (2026-08-29): leverantörens användar-id.
        googleId: true,
        appleId: true,
        // Gästskanning (2026-08-29): enheter kontot skannat från + räknarna.
        // Raden överlever kontoradering med flit (SetNull) — men den HÖR till
        // personen så länge länken finns, alltså med i exporten.
        guestDevices: { select: { id: true, guestScans: true, monthScans: true, createdAt: true } },
        // Aktivitetsstämpeln adminpanelen visar som "senast sedd" (2026-08-14).
        // Det är en uppgift OM personen och måste därför med i exporten — samma
        // resonemang som traderaUserId ovan, som saknades i ett år.
        lastSeenAt: true,
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
        // ⛔ Art. 15/20: ALL användarkopplad data måste med. Den explicita selecten
        // gör att en ny relation aldrig hamnar här av sig själv — lägg till den när
        // en ny personkopplad tabell införs.
        sales: true,
        setWatches: { include: { set: { select: { name: true } } } },
        // Utmärkelser är uppgifter OM personen (vad de gjort och när) — art. 15/20.
        achievements: true,
        // Skanningar/graderingar: metadata + graderingsutfallet (som visas i appen).
        // Skannerns `result` utelämnas med flit — det är intern diagnostik (konst-
        // avtryck m.m.), inte användarinnehåll; datumen/utfallet är personuppgiften.
        scannerJobs: {
          select: { id: true, status: true, confidence: true, createdAt: true },
        },
        gradingJobs: {
          select: {
            id: true,
            status: true,
            overallGrade: true,
            confidence: true,
            modelUsed: true,
            result: true,
            createdAt: true,
          },
        },
        // Push-enheter: plattform + datum, ALDRIG själva token (device-hemlighet).
        pushTokens: { select: { platform: true, createdAt: true } },
        savedPosts: { select: { postId: true, createdAt: true } },
        likes: { select: { postId: true, createdAt: true } },
        reports: { select: { postId: true, reason: true, status: true, createdAt: true } },
        offerReports: {
          select: { offerId: true, reason: true, note: true, status: true, createdAt: true },
        },
        invitesSent: {
          select: { id: true, createdAt: true, usedAt: true, verifiedAt: true, rewardedAt: true },
        },
        inviteUsed: { select: { createdAt: true, usedAt: true, verifiedAt: true } },
      },
    });
    if (!user) throw new AuthError(404, "Användaren hittades inte.");

    // Interna debug-nycklar (t.ex. _pushError) läcker annars in i en användarvänd
    // GDPR-export. Behåll bara "riktiga" inställningar, inte underscore-prefix.
    const cleanSettings =
      user.notificationSettings && typeof user.notificationSettings === "object"
        ? Object.fromEntries(
            Object.entries(user.notificationSettings as Record<string, unknown>).filter(
              ([k]) => !k.startsWith("_"),
            ),
          )
        : user.notificationSettings;

    const exportData = {
      exportedAt: new Date().toISOString(),
      service: "Foilio",
      description: "GDPR-dataexport. All data kopplad till ditt konto.",
      profile: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        planTier: user.planTier,
        bonusProUntil: user.bonusProUntil,
        stripeProUntil: user.stripeProUntil,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        emailVerifiedAt: user.emailVerifiedAt,
        onboardingCompleted: user.onboardingCompleted,
        notificationSettings: cleanSettings,
        preferences: user.preferences,
        reputationScore: user.reputationScore,
        isPublicCollection: user.isPublicCollection,
        lastPushError: user.lastPushError,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      // Kopplade tredjepartskonton. Bara identifierarna — vi lagrar inga
      // Discord-token alls, och Tradera-token är en hemlighet som inte hör hemma
      // i en nedladdningsbar fil.
      connectedAccounts: {
        tradera: user.traderaUserId ? { userId: user.traderaUserId } : null,
        discord: user.discordUserId
          ? {
              userId: user.discordUserId,
              username: user.discordUsername,
              linkedAt: user.discordLinkedAt,
            }
          : null,
      },
      watchlist: user.watchlistItems,
      setWatches: user.setWatches,
      collection: user.collectionItems,
      sales: user.sales,
      posts: user.posts,
      comments: user.comments,
      likes: user.likes,
      savedPosts: user.savedPosts,
      alerts: user.alerts,
      communityReports: user.reports,
      offerReports: user.offerReports,
      scanHistory: user.scannerJobs,
      gradingHistory: user.gradingJobs,
      pushDevices: user.pushTokens,
      invitesSent: user.invitesSent,
      inviteUsed: user.inviteUsed,
    };

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="foilio-data.json"',
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
