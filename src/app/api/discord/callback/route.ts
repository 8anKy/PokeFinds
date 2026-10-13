import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma, withDbRetry } from "@/lib/db";
import {
  discordLinkingEnabled,
  DISCORD_RETURN_COOKIE,
  DISCORD_RETURN_PATHS,
  DISCORD_STATE_COOKIE,
  exchangeCode,
  fetchIdentity,
  joinGuild,
} from "@/lib/discord";
import { revokeDiscordRoles, syncDiscordRoles, DISCORD_SYNC_SELECT } from "@/services/discord-sync";
import { invalidateGiveawayUser } from "@/services/giveaway";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/**
 * Alla utgångar går tillbaka med en statuskod i URL:en — till inställningarna,
 * eller till den vitlistade sidan kopplingen startades från (giveawayn).
 */
function back(status: string, returnTo: string | null = null) {
  const url = new URL(returnTo ?? "/installningar/kopplingar", APP_URL);
  url.searchParams.set("discord", status);
  const res = NextResponse.redirect(url);
  res.cookies.set(DISCORD_STATE_COOKIE, "", { path: "/api/discord", maxAge: 0 });
  res.cookies.set(DISCORD_RETURN_COOKIE, "", { path: "/api/discord", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const ret = req.cookies.get(DISCORD_RETURN_COOKIE)?.value ?? null;
  const returnTo = ret && DISCORD_RETURN_PATHS.includes(ret) ? ret : null;
  const done = (status: string) => back(status, returnTo);
  if (!discordLinkingEnabled()) return done("fel-avstangd");

  const session = await auth();
  if (!session?.user) return done("fel-ingen-session");

  // Användaren tryckte "Avbryt" i Discords ruta. Inte ett fel — ett val.
  if (req.nextUrl.searchParams.get("error")) return done("nekad");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get(DISCORD_STATE_COOKIE)?.value;
  if (!code) return done("fel-ingen-kod");
  // CSRF: `state` måste matcha cookien som /connect satte i DENNA webbläsare.
  if (!state || !cookieState || state !== cookieState) return done("fel-state");

  const accessToken = await exchangeCode(code);
  if (!accessToken) return done("fel-token");

  const identity = await fetchIdentity(accessToken);
  if (!identity) return done("fel-identitet");

  // Är Discord-kontot redan knutet till NÅGON ANNAN? Utan den här kontrollen
  // hade en enda Pro-prenumeration kunnat ge Pro-rollen via hur många
  // Scoutr-konton som helst. Kollas före skrivningen för att kunna ge ett
  // begripligt besked; unik-indexet nedan är det som faktiskt garanterar det.
  const existing = await withDbRetry(() =>
    prisma.user.findUnique({
      where: { discordUserId: identity.id },
      select: { id: true },
    })
  );
  if (existing && existing.id !== session.user.id) return done("fel-redan-lankad");

  // Bytte användaren Discord-konto? Ta rollerna från det gamla först — annars
  // ligger Pro-rollen kvar på ett konto vi inte längre följer och som därför
  // aldrig städas av nattjobbet.
  const previous = await withDbRetry(() =>
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { discordUserId: true },
    })
  );
  if (previous?.discordUserId && previous.discordUserId !== identity.id) {
    await revokeDiscordRoles(previous.discordUserId, "Scoutr: kontot bytte Discord-konto");
  }

  // Lägg till i servern. ⛔ Rollerna sätts INTE här: Discord returnerar 204 utan
  // att applicera dem när personen redan är medlem. De sätts av syncDiscordRoles.
  const joined = await joinGuild(identity.id, accessToken);
  if (!joined) return done("fel-servern");
  // Härefter behövs användartoken aldrig mer — den sparas ALDRIG (se lib/discord.ts).

  let user;
  try {
    user = await withDbRetry(() =>
      prisma.user.update({
        where: { id: session.user.id },
        data: {
          discordUserId: identity.id,
          discordUsername: identity.username,
          discordLinkedAt: new Date(),
        },
        select: DISCORD_SYNC_SELECT,
      })
    );
  } catch (err) {
    // Kapplöpning mot unik-indexet: någon annan hann länka samma Discord-konto.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return done("fel-redan-lankad");
    }
    throw err;
  }

  // Loggningen får aldrig fälla själva länkningen: kopplingen ÄR redan skriven
  // här, och ett kast hade gett användaren en felsida för något som redan lyckats.
  try {
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "user.discord.linked",
        entityType: "User",
        entityId: user.id,
        // ⛔ Bara id:t, aldrig användarnamnet: loggen är långlivad och namnet är
        // personuppgiften. Id:t räcker helt för att felsöka en rollsättning.
        metadata: { discordUserId: identity.id },
      },
    });
  } catch (err) {
    console.error("[discord] kunde inte skriva AuditLog för länkningen:", err);
  }

  const result = await syncDiscordRoles(user, "Scoutr: kontot länkades");
  // Giveawayns Discord-lott ska synas direkt, inte efter cachens minut.
  invalidateGiveawayUser(session.user.id);
  return done(result.ok ? "ansluten" : "fel-roll");
}
