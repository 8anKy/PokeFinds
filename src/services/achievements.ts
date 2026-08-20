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
  ACHIEVEMENTS,
  EMPTY_STATS,
  achievementByKey,
  achievementOrder,
  thresholdFor,
  type AchievementMetric,
  type AchievementStats,
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

// ---------- Framstegsvyn: vad är kvar, och hur når man dit? ----------

/**
 * Mätvärdena för EN användare — det som gör "21 av 100" möjligt att visa.
 *
 * ⛔ EN FRÅGA. Samma nio grenar som nattsvepets `UNION ALL`, men filtrerade på en
 * användare, plus kompletta set som en tionde gren. Nio separata `count()` hade
 * varit nio rundturer mot Frankfurt för en enda sida.
 *
 * ⛔ **DE HÄR TALEN DELAR ALDRIG UT NÅGOT.** De visar bara framsteg. Utdelningen
 * sker i nattsvepet, och tabellen är facit — annars hade ett märke kunnat dyka
 * upp i en vy och saknas i en annan beroende på vem som räknade senast.
 * ⛔ Kompletta set kräver `totalCardsFull > 0`, exakt som svepet: ett set utan
 * uppströmsfacit får aldrig räknas som klart. Se `lib/set-denominator.ts`.
 */
export async function loadUserStats(userId: string): Promise<AchievementStats> {
  const rows = await prisma.$queryRaw<{ metric: string; n: number }[]>`
    SELECT 'collectionLots' AS metric, COUNT(*)::int AS n
      FROM "CollectionItem" WHERE "userId" = ${userId}
    UNION ALL
    SELECT 'distinctSets', COUNT(DISTINCT c."setId")::int
      FROM "CollectionItem" ci JOIN "Card" c ON c.id = ci."cardId"
      WHERE ci."userId" = ${userId}
    UNION ALL
    SELECT 'scans', COUNT(*)::int
      FROM "ScannerJob" WHERE "userId" = ${userId} AND status = 'COMPLETED'
    UNION ALL
    SELECT 'gradings', COUNT(*)::int
      FROM "GradingJob" WHERE "userId" = ${userId} AND status <> 'FAILED'
    UNION ALL
    SELECT 'sales', COUNT(*)::int FROM "Sale" WHERE "userId" = ${userId}
    UNION ALL
    SELECT 'profitableSales', COUNT(*)::int
      FROM "Sale"
      WHERE "userId" = ${userId}
        AND "purchasePriceOre" IS NOT NULL
        AND "salePriceOre" > "purchasePriceOre"
    UNION ALL
    SELECT 'watchlistItems', COUNT(*)::int
      FROM "WatchlistItem" WHERE "userId" = ${userId}
    UNION ALL
    SELECT 'sentAlerts', COUNT(*)::int
      FROM "Alert" WHERE "userId" = ${userId} AND status = 'SENT'
    UNION ALL
    SELECT 'verifiedInvites', COUNT(*)::int
      FROM "Invite" WHERE "inviterId" = ${userId} AND "verifiedAt" IS NOT NULL
    UNION ALL
    SELECT 'membershipDays',
           GREATEST(0, DATE_PART('day', NOW() AT TIME ZONE 'UTC' - u."createdAt"))::int
      FROM "User" u WHERE u.id = ${userId}
    UNION ALL
    SELECT 'discordLinked', CASE WHEN u."discordUserId" IS NOT NULL THEN 1 ELSE 0 END
      FROM "User" u WHERE u.id = ${userId}
    UNION ALL
    SELECT 'completedSets', COUNT(*)::int FROM (
      SELECT c."setId"
        FROM "CollectionItem" ci JOIN "Card" c ON c.id = ci."cardId"
        JOIN "CardSet" s ON s.id = c."setId"
        LEFT JOIN (SELECT "setId" AS sid, COUNT(*)::int AS cnt FROM "Card" GROUP BY "setId") k
          ON k.sid = s.id
       WHERE ci."userId" = ${userId} AND s."totalCardsFull" > 0
       GROUP BY c."setId", s."totalCardsFull", k.cnt
      HAVING COUNT(DISTINCT ci."cardId") >= GREATEST(s."totalCardsFull", COALESCE(k.cnt, 0))
    ) done`;

  const stats: AchievementStats = { ...EMPTY_STATS };
  for (const r of rows) {
    if (r.metric in stats) stats[r.metric as AchievementMetric] = Number(r.n) || 0;
  }
  return stats;
}

export interface AchievementProgress {
  key: string;
  labelKey: string;
  descKey: string;
  icon: string;
  variant: AchievementVariant;
  /** Högsta upplåsta nivån. 0 = ingen ännu. */
  earnedTier: number;
  tierCount: number;
  tiered: boolean;
  /** Nivån man jobbar mot just nu. null = alla nivåer klara. */
  nextTier: number | null;
  /** Tröskeln beskrivningen ska interpolera in — nästa nivå, annars den sista. */
  threshold: number;
  /** Var användaren står i mätvärdet just nu. */
  current: number;
  /** 0–100 mot nästa nivå. null = klar, eller ett mått där en stapel är nonsens. */
  percent: number | null;
  done: boolean;
  unlockedAt: Date | null;
}

/**
 * Katalogen + användarens rader + mätvärdena → en rad per märke, KLARA SOM
 * OKLARA. Ren funktion: inga anrop, testbar.
 *
 * ⛔ **ALLA 15 MÄRKEN RETURNERAS, ALLTID.** Vyn måste kunna visa det man INTE
 * har och hur man når dit — en lista med bara de upplåsta säger ingenting om vad
 * som finns kvar, och det var precis klagomålet som byggde den här sidan.
 *
 * ⛔ `earnedTier` läses ur de LAGRADE raderna, aldrig ur `stats`. Talen här är
 * bara framsteg; utdelningen är nattsvepets jobb och tabellen är facit.
 * Konsekvensen är avsiktlig: den som passerat en tröskel i dag ser "99 av 100 →
 * 100 av 100" men får själva märket först efter nattens körning.
 */
export function buildAchievementProgress(
  earned: UserAchievementView[],
  stats: AchievementStats
): AchievementProgress[] {
  const earnedByKey = new Map<string, UserAchievementView[]>();
  for (const e of earned) {
    const list = earnedByKey.get(e.key);
    if (list) list.push(e);
    else earnedByKey.set(e.key, [e]);
  }

  return ACHIEVEMENTS.map((def) => {
    const mine = earnedByKey.get(def.key) ?? [];
    const earnedTier = mine.reduce((max, e) => Math.max(max, e.tier), 0);
    const nextTier = earnedTier < def.tiers.length ? earnedTier + 1 : null;
    const threshold = thresholdFor(def, nextTier ?? def.tiers.length) ?? def.tiers[def.tiers.length - 1];
    const current = stats[def.metric];
    const highest = mine.find((e) => e.tier === earnedTier) ?? null;
    return {
      key: def.key,
      labelKey: def.labelKey,
      descKey: def.descKey,
      icon: def.icon,
      variant: def.variant,
      earnedTier,
      tierCount: def.tiers.length,
      tiered: def.tiers.length > 1,
      nextTier,
      threshold,
      current,
      // ⛔ Ingen stapel för ett ja/nej-mått: "0 av 1" som en halvtom stapel läser
      // som framsteg, och man är antingen kopplad till Discord eller inte.
      percent:
        nextTier == null || threshold <= 1
          ? null
          : Math.min(100, Math.round((current / threshold) * 100)),
      done: nextTier == null,
      unlockedAt: highest?.unlockedAt ?? null,
    };
  });
}
