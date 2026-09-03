import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser, AuthError } from "@/lib/auth";
import { isPro, proSource } from "@/lib/plan";
import { revokeDiscordRoles } from "@/services/discord-sync";
import { getStripe, stripeEnabled } from "@/lib/stripe";
import { deleteUserImages } from "@/lib/object-storage";
import { revalidateTag } from "next/cache";
import { TRADERA_SELLER_ITEMS_TAG } from "@/lib/tradera-seller-items";

export const dynamic = "force-dynamic";

const profileSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  planTier: true,
  bonusProUntil: true,
  // ⛔ Måste med: isPro() nedan räknar på den här formen, och ett fält som INTE
  // är valt blir `undefined` → vakten failar ÖPPET och en betalande webbkund
  // hade setts som gratisanvändare. Samma familj som variantLabel-missen 07-28.
  stripeProUntil: true,
  stripeCustomerId: true,
  avatarUrl: true,
  bio: true,
  emailVerifiedAt: true,
  onboardingCompleted: true,
  notificationSettings: true,
  preferences: true,
  reputationScore: true,
  isPublicCollection: true,
  showTraderaListings: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

/**
 * Svarsformen. `stripeCustomerId` väljs för att kunna avgöra om kontot har ett
 * WEBBköp (→ visa "Hantera prenumeration", som öppnar Stripes kundportal), men
 * skickas aldrig ut: klienten behöver svaret på frågan, inte kundens id hos en
 * tredje part. Den som köpt i app:en har ingen Stripe-kund och hänvisas till
 * App Store i stället.
 */
function publicProfile(user: Prisma.UserGetPayload<{ select: typeof profileSelect }>) {
  const { stripeCustomerId, ...rest } = user;
  return {
    ...rest,
    isPro: isPro(user),
    hasWebSubscription: !!stripeCustomerId,
    // Varför användaren har Pro — gränssnittet får bara lova uppsägning för den
    // källa som faktiskt går att säga upp hos oss. Se proSource().
    proSource: proSource(user),
  };
}

const notificationSettingsSchema = z.object({
  email: z.boolean().optional(),
  push: z.boolean().optional(),
  allRestocks: z.boolean().optional(),
  news: z.boolean().optional(),
  // Veckobrevet. ⛔ Måste stå här — Zod strippar okända nycklar, så en glömd rad
  // hade gjort avstängningen i /installningar till en tyst no-op.
  weekly: z.boolean().optional(),
});

const patchSchema = z.object({
  name: z.string().trim().min(4, "Namnet måste vara 4–12 tecken.").max(12, "Namnet måste vara 4–12 tecken.").optional(),
  notificationSettings: notificationSettingsSchema.optional(),
  preferences: z.record(z.unknown()).optional(),
  isPublicCollection: z.boolean().optional(),
  // "Visa mina Tradera-annonser på min profil" — samtycket för profilens
  // Tradera-kort. Nollas av /api/tradera DELETE när kopplingen bryts.
  showTraderaListings: z.boolean().optional(),
});

export async function GET() {
  try {
    const sessionUser = await requireUser();
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: profileSelect,
    });
    if (!user) throw new AuthError(404, "Användaren hittades inte.");
    // isPro = planTier, admin-roll, referral-bonus ELLER Stripe. Klienter ska
    // grinda på detta, inte på planTier.
    return jsonOk(publicProfile(user));
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
      select: {
        notificationSettings: true,
        preferences: true,
        planTier: true,
        role: true,
        bonusProUntil: true,
        stripeProUntil: true, // "Alla restocks" är Pro-only — webbkunder räknas
        traderaUserId: true, // showTraderaListings kräver en koppling att visa
      },
    });
    if (!current) throw new AuthError(404, "Användaren hittades inte.");

    // "Alla restocks" är Pro-only — tysta ner försök från gratisanvändare.
    if (input.notificationSettings?.allRestocks === true && !isPro(current)) {
      input.notificationSettings.allRestocks = false;
    }

    const data: Prisma.UserUpdateInput = {};
    if (input.name !== undefined) {
      const nameTaken = await prisma.user.findFirst({
        where: { name: { equals: input.name, mode: "insensitive" }, id: { not: sessionUser.id } },
        select: { id: true },
      });
      if (nameTaken) throw new AuthError(409, "Användarnamnet är upptaget. Välj ett annat.");
      data.name = input.name;
    }
    if (input.isPublicCollection !== undefined) data.isPublicCollection = input.isPublicCollection;
    if (input.showTraderaListings !== undefined) {
      // Samtycket gäller bara en KOPPLAD säljare. Utan Tradera-id finns inget att
      // visa, och en sann flagga på ett okopplat konto hade tyst börjat visa
      // annonser den dag ett id dyker upp — utan att någon bett om det då.
      data.showTraderaListings = input.showTraderaListings && !!current.traderaUserId;
    }
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

    // Slår ägaren PÅ Tradera-visningen ska annonserna synas direkt — inte när
    // 15-minutersfönstret råkar löpa ut. Profilen kan ha cachat en tom lista
    // medan reglaget var av (mätt 2026-09-03: ägaren la upp en annons och såg
    // ingenting). Taggen är gemensam för alla säljare: nästa profilvisning
    // hämtar om, kostnaden är ett Tradera-anrop per visad profil, noll Neon.
    if (data.showTraderaListings === true) revalidateTag(TRADERA_SELLER_ITEMS_TAG);

    return jsonOk(publicProfile(user));
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE() {
  try {
    const sessionUser = await requireUser();
    // GDPR: ta bort Discord-rollerna FÖRE raderingen. Efteråt finns ingen rad att
    // läsa `discordUserId` ur, och personen hade blivit kvar i servern med en
    // Pro-roll som inte längre hör till något konto — en kvarleva av ett raderat
    // konto, dvs precis det art. 17 säger att vi ska bli av med. Medlemskapet
    // rörs inte; vi kickar ingen.
    const linked = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: { discordUserId: true, stripeSubscriptionId: true },
    });
    await revokeDiscordRoles(linked?.discordUserId, "Foilio: kontot raderades");

    // ⛔ AVSLUTA STRIPE-PRENUMERATIONEN FÖRE raderingen. User-raden bär
    // stripeSubscriptionId; raderar vi den utan att säga upp fortsätter kortet
    // debiteras och webhooken kan aldrig mer mappa prenumerationen till ett konto
    // (tyst tills en återkravstvist). Får ALDRIG blockera raderingen — GDPR art. 17
    // väger tyngre än en städad prenumeration — men vi måste FÖRSÖKA och logga högt.
    if (linked?.stripeSubscriptionId && stripeEnabled()) {
      try {
        await getStripe().subscriptions.cancel(linked.stripeSubscriptionId);
      } catch (stripeErr) {
        console.error(
          `[users/me DELETE] Kunde inte säga upp Stripe-prenumeration ${linked.stripeSubscriptionId} för raderat konto:`,
          stripeErr
        );
      }
    }

    // OfferReport har reporterId → SetNull vid radering, men den fria texten `note`
    // (kan innehålla vad som helst användaren skrivit) överlever annars raderingen.
    // Nolla den först så ingen personuppgift blir kvar i en anonymiserad rad.
    await prisma.offerReport.updateMany({
      where: { reporterId: sessionUser.id },
      data: { note: null },
    });

    // Forumbilder ligger i objektlagringen, utanför databasen — Cascade når dem
    // inte. Prefixet `forum/<userId>/` gör städningen till ett list+delete-anrop
    // (lib/object-storage.ts). Best effort: ett fel hos bucketen får aldrig
    // stoppa raderingen (art. 17), men loggas högt så det går att städa i efterhand.
    try {
      await deleteUserImages(sessionUser.id);
    } catch (storageErr) {
      console.error(`[users/me DELETE] Kunde inte radera forumbilder för ${sessionUser.id}:`, storageErr);
    }

    // Övriga relationer hanteras via onDelete: Cascade i schemat.
    await prisma.user.delete({ where: { id: sessionUser.id } });
    return jsonOk({ message: "Ditt konto och all din data har raderats." });
  } catch (e) {
    return apiError(e);
  }
}
