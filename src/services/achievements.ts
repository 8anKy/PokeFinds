/**
 * LÄSVÄGEN för utmärkelser: vad har den här användaren låst upp?
 *
 * ⛔ **EN FRÅGA, ALDRIG EN PER MÄRKE.** Vyn ritar upp till 15 märken samtidigt;
 * ett uppslag per märke hade blivit 15 rundturer mot Frankfurt för en rad ikoner.
 * Katalogen (namn, ikon, tröskel) bor i `src/lib/achievements.ts` och kostar
 * ingenting att slå upp — databasen tillfrågas bara om VAD som är utdelat.
 *
 * ⛔ **RÄKNA ALDRIG OM MÄRKENA HÄR.** Tabellen är facit (se `UserAchievement` i
 * schema.prisma): ett märke är ett historiskt faktum och får inte kunna försvinna
 * för att användaren sålt av sin samling. En live-uträkning hade dessutom kostat
 * ett halvdussin aggregat per sidvisning — Neons nota är VAKEN TID.
 *
 * ⛔ **INGEN `auth()` I EN ISR-CACHAD SIDA.** Den här tjänsten är personlig och
 * hör hemma i en dynamisk vy (/mer, profilsidan) eller bakom ett API som
 * klientkomponenten hämtar — läggs den i den delade chrome:n blir HELA appen
 * dynamisk (se Caching/ISR i CLAUDE.md).
 */
import { prisma } from "@/lib/db";
import {
  achievementByKey,
  achievementOrder,
  thresholdFor,
  type AchievementVariant,
} from "@/lib/achievements";

export interface UserAchievementView {
  id: string;
  /** Stabil slug — i18n-uppslaget och React-nyckeln. */
  key: string;
  tier: number;
  unlockedAt: Date;
  /** null = ännu inte omtalat för användaren (veckobrevet stämplar EFTER utskick). */
  announcedAt: Date | null;
  /** Ögonblicksbilden av skälet, som den skrevs vid utdelningen. */
  meta: unknown;
  /** i18n-nyckel i namnrymden `Achievements`. */
  labelKey: string;
  /** i18n-nyckel i namnrymden `Achievements`. Tar `{count}` = `threshold`. */
  descKey: string;
  /** Ikonnamn ur `src/components/ui/icons.tsx` ("IconCards"). */
  icon: string;
  variant: AchievementVariant;
  /** Nivåns tröskel — det tal beskrivningen ska interpolera in. */
  threshold: number;
  /** Sant för märken med fler än en nivå (då är nivåetiketten värd att visa). */
  tiered: boolean;
}

/**
 * Användarens utmärkelser, i KATALOGORDNING (inte kronologisk).
 *
 * ⛔ Rader vars `key` inte längre finns i katalogen SLÄNGS UR SVARET men aldrig ur
 * databasen. En slug som tagits ur bruk är fortfarande historik om vad personen
 * gjorde; att radera raden för att UI:t inte kan rita den vore att skriva om
 * historien för att spara en if-sats.
 */
export async function listUserAchievements(userId: string): Promise<UserAchievementView[]> {
  const rows = await prisma.userAchievement.findMany({
    where: { userId },
    select: { id: true, key: true, tier: true, unlockedAt: true, announcedAt: true, meta: true },
  });

  return rows
    .flatMap((row) => {
      const def = achievementByKey(row.key);
      if (!def) return [];
      const threshold = thresholdFor(def, row.tier);
      // Okänd NIVÅ på ett känt märke: katalogen har krympt (t.ex. 1000-nivån
      // borttagen). Samma behandling som okänd nyckel — visa inte, radera inte.
      if (threshold == null) return [];
      return [
        {
          id: row.id,
          key: row.key,
          tier: row.tier,
          unlockedAt: row.unlockedAt,
          announcedAt: row.announcedAt,
          meta: row.meta,
          labelKey: def.labelKey,
          descKey: def.descKey,
          icon: def.icon,
          variant: def.variant,
          threshold,
          tiered: def.tiers.length > 1,
        } satisfies UserAchievementView,
      ];
    })
    // Katalogordning först, högsta nivån sist inom samma märke — trappan ska läsa
    // som en trappa. Sorteringen sker i minnet på en handfull rader; en `orderBy`
    // i SQL kan inte uttrycka katalogens ordning ändå.
    .sort((a, b) => achievementOrder(a.key) - achievementOrder(b.key) || a.tier - b.tier);
}

/**
 * Stämpla märken som OMTALADE.
 *
 * ⛔ **ANROPAS EFTER ETT LYCKAT UTSKICK, ALDRIG FÖRE.** Stämplas de innan mejlet
 * gått iväg tystar ett TILLFÄLLIGT mejlfel användaren för alltid — märket räknas
 * som meddelat och tas aldrig upp igen. Exakt samma regel som
 * `User.weeklyDigestSentAt` och `proExpiryNotifiedAt` bär, och samma bugg som en
 * gång brände hela veckans utskick tyst.
 *
 * ⛔ `announcedAt: null` i filtret gör anropet idempotent: ett omkört utskick
 * flyttar aldrig en redan satt tidsstämpel framåt, så "när fick jag veta det här?"
 * fortsätter vara sant.
 */
export async function markAnnounced(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await prisma.userAchievement.updateMany({
    where: { id: { in: ids }, announcedAt: null },
    data: { announcedAt: new Date() },
  });
  return res.count;
}
