/**
 * UTMÄRKELSESVEPET — delar ut nya märken till ALLA användare, en gång per natt.
 *
 * ⛔ **SET-BASERADE AGGREGAT ÖVER HELA ANVÄNDARBASEN, ALDRIG EN FRÅGA PER
 * ANVÄNDARE.** Samma regel som veckobrevet bär i `loadSetProgress()`: en loop med
 * ett uppslag per mottagare är exakt det misstag som höll computen vaken dygnet
 * runt 2026-07-07, och Neons nota är VAKEN TID — varje väckning köper minst 300 s
 * debiterad tid. Hela jobbet är fem satser oavsett om det finns 60 eller 60 000
 * konton: ett UNION ALL-aggregat, set-kompletteringen, användarraderna, det som
 * redan är utdelat, och EN `createMany`.
 *
 * ⛔ **LIGGER SOM ETT STEG I `scrape-all.yml`, ALDRIG SOM EGEN CRON.** Neon är
 * redan vaken i det fönstret. En egen nattlig start hade varit ytterligare en
 * väckning för ett jobb som tar sekunder — och nattkedjan är dessutom redan tre
 * led djup (scrape-all → tradera-sweep → cardtrader-refresh); ett fjärde
 * `workflow_run`-led fyrar ALDRIG, tyst (upptäckt 2026-08-12, två månader utan
 * körningar). Nya nattjobb läggs som STEG i ett befintligt led.
 *
 * ⛔ **JOBBET ÄR IDEMPOTENT OCH FÅR KÖRAS OM FRITT.** `@@unique([userId, key,
 * tier])` + `skipDuplicates: true` gör en omkörning till noll skrivningar. Det är
 * därför märkena räknas ut här och inte i en krok på varje skrivväg i appen: en
 * "kolla efter varje tillägg"-krok hade blivit ett halvdussin uppslag per klick.
 *
 * ⛔ **MÄRKEN TAS ALDRIG BORT.** Svepet skriver bara INSERT. Den som en gång ägde
 * 1 000 poster och sedan sålt av dem har fortfarande klarat 1 000 — en utmärkelse
 * som kan tas ifrån en är ingen utmärkelse. Se `UserAchievement` i schema.prisma.
 *
 * ⛔ **`announcedAt` LÄMNAS NULL HÄR.** Svepet delar ut, det MEDDELAR inte. Den
 * som skickar (veckobrevet) stämplar EFTER lyckat utskick — stämplas den före
 * tystar ett tillfälligt mejlfel användaren för alltid (samma regel som
 * `weeklyDigestSentAt` och `proExpiryNotifiedAt`).
 */
import { Prisma } from "@prisma/client";
import { prisma, withDbRetry } from "@/lib/db";
import { SET_FULL_TOTAL_SQL } from "@/lib/set-denominator";
import { utcToday } from "@/lib/utils";
import {
  ACHIEVEMENTS,
  EMPTY_STATS,
  daysSinceUtc,
  evaluateAchievements,
  grantId,
  newGrants,
  type AchievementGrant,
  type AchievementStats,
} from "@/lib/achievements";

/**
 * ⛔ EN INSERT MED 50 000 TUPLER ÄR EN FLERMEGABYTES-SATS. Första skarpa körningen
 * delar ut allt historiskt på en gång (varje konto med ett kort får minst
 * `forsta_kortet`), så taket finns för den enda körning som någonsin blir stor.
 * Efter den är dagsvolymen ett fåtal rader och loopen kör exakt ett varv.
 */
const CREATE_CHUNK = 2000;

/** En rad ur UNION ALL-aggregatet: (användare, mätvärde, antal). */
interface MetricRow {
  userId: string;
  metric: string;
  n: number;
}

/** Ett FULLT komplett set för en användare. Bär namnet — det ska ögonblicksbildas. */
interface CompletedSetRow {
  userId: string;
  setId: string;
  setName: string;
  owned: number;
  total: number;
}

export interface AchievementSweepResult {
  /** Antal konton som fanns när svepet kördes. */
  users: number;
  /** Antal konton som förtjänade minst ett NYTT märke. */
  usersGranted: number;
  /** Totalt antal nya rader. */
  granted: number;
  /** Nya rader per märkesnyckel — det som är värt att läsa i loggen. */
  byKey: Record<string, number>;
}

/**
 * ALLA RÄKNADE MÄTVÄRDEN I **EN** RUNDTUR.
 *
 * ⛔ UNION ALL, inte nio separata frågor. Varje gren är ett eget `GROUP BY` som
 * Postgres kör lokalt; det som sparas är åtta rundturer mot Frankfurt per natt,
 * och framför allt att antalet frågor inte växer när katalogen växer.
 *
 * ⛔ `::int` PÅ VARJE `COUNT` — utan casten returnerar Postgres `bigint`, Prisma
 * ger `BigInt` i JS, och `value >= threshold` mot en `number` kastar TypeError vid
 * körning. Det syns inte i typerna eftersom `$queryRaw` litar på vår egen
 * radtyp.
 *
 * ⛔ `distinctSets` JOINAR `Card` — sealed-poster (`cardId IS NULL`) är inga kort
 * i ett set, och `COUNT(DISTINCT …)` hoppar dessutom över NULL av sig själv.
 * Bältet OCH hängslena, för `setjagare` ska betyda "kort ur N olika set".
 *
 * ⛔ `gradings` räknar `status <> 'FAILED'` (inte `= 'COMPLETED'`): graderingen
 * skriver RUNNING → COMPLETED/FAILED, och en körning som dog med processen blir
 * kvar på RUNNING för alltid. Användaren HAR gjort sin första gradering — vi
 * betalade till och med för den — så att kräva COMPLETED hade gjort märket
 * beroende av att vår egen process överlevde.
 */
async function loadMetricRows(): Promise<MetricRow[]> {
  return withDbRetry(() =>
    prisma.$queryRaw<MetricRow[]>`
      SELECT ci."userId" AS "userId", 'collectionLots' AS metric, COUNT(*)::int AS n
        FROM "CollectionItem" ci GROUP BY ci."userId"
      UNION ALL
      SELECT ci."userId", 'distinctSets', COUNT(DISTINCT c."setId")::int
        FROM "CollectionItem" ci JOIN "Card" c ON c.id = ci."cardId"
        GROUP BY ci."userId"
      UNION ALL
      SELECT sj."userId", 'scans', COUNT(*)::int
        FROM "ScannerJob" sj WHERE sj.status = 'COMPLETED' GROUP BY sj."userId"
      UNION ALL
      SELECT gj."userId", 'gradings', COUNT(*)::int
        FROM "GradingJob" gj WHERE gj.status <> 'FAILED' GROUP BY gj."userId"
      UNION ALL
      SELECT s."userId", 'sales', COUNT(*)::int
        FROM "Sale" s GROUP BY s."userId"
      UNION ALL
      SELECT s."userId", 'profitableSales', COUNT(*)::int
        FROM "Sale" s
        WHERE s."purchasePriceOre" IS NOT NULL
          AND s."salePriceOre" > s."purchasePriceOre"
        GROUP BY s."userId"
      UNION ALL
      SELECT w."userId", 'watchlistItems', COUNT(*)::int
        FROM "WatchlistItem" w GROUP BY w."userId"
      UNION ALL
      SELECT a."userId", 'sentAlerts', COUNT(*)::int
        FROM "Alert" a WHERE a.status = 'SENT' GROUP BY a."userId"
      UNION ALL
      SELECT i."inviterId", 'verifiedInvites', COUNT(*)::int
        FROM "Invite" i WHERE i."verifiedAt" IS NOT NULL GROUP BY i."inviterId"
    `
  );
}

/**
 * FULLT KOMPLETTA SET PER ANVÄNDARE — en fråga för hela basen.
 *
 * ⛔ **NÄMNAREN ÄR `GREATEST(totalCardsFull, vårt kortantal)`**, delad med resten
 * av appen via `SET_FULL_TOTAL_SQL` (`src/lib/set-denominator.ts`). Två fel den
 * stänger, båda hittade i drift: `totalCards` är `printedTotal` (talet på kortet,
 * "12/84") och ger en secret rare-ägare "120 av 84", och när VÅR kortlista är
 * längre än uppströmsfacit blir "du äger allt" omöjligt att nå.
 *
 * ⛔ **`totalCardsFull = 0` BETYDER OKÄNT OCH MÅSTE UTESLUTAS.** Japanska set (95
 * st) har inget pokemontcg.io-facit och står kvar på 0 med flit. Utan `> 0`-
 * villkoret hade nämnaren fallit tillbaka på vårt eget kortantal — och för ett
 * japanskt set där vi listar tre kort hade "äger 3 av 3" delat ut `fullt_set` för
 * ett set användaren knappt börjat på. Ett okänt facit är inte ett litet facit.
 *
 * ⚠️ **DÄRFÖR ÄR SVEPET STRÄNGARE ÄN `resolveSetTotals()`** i samma modul, som
 * returnerar `max(totalCardsFull, cardCount)` och bara faller till `null` när BÅDA
 * är 0. Divergensen gäller exakt en klass: set med okänt facit men kort hos oss.
 * Webben får då visa "3 av 3" — en procent som rättar sig av sig själv nästa gång
 * katalogen växer. ⛔ En UTMÄRKELSE rättar sig ALDRIG: den skrivs en gång och tas
 * aldrig tillbaka (se filens topp), så ett falskt "Fullt set" sitter kvar för
 * alltid. Sänk aldrig den här vakten för att matcha webben — höj webbens i stället.
 *
 * Ordningen (`releaseDate` först) är vad `fullt_set`-ögonblicksbilden pekar på:
 * det ÄLDSTA kompletta setet är det man rimligen fyllde först. Nyckeln är stabil
 * (`setId` som sista led) så en omkörning väljer samma set.
 */
async function loadCompletedSets(): Promise<Map<string, CompletedSetRow[]>> {
  const rows = await withDbRetry(() =>
    prisma.$queryRaw<CompletedSetRow[]>`
      WITH ourcnt AS (
        SELECT "setId" AS sid, COUNT(*)::int AS cnt FROM "Card" GROUP BY "setId"
      ),
      owned AS (
        SELECT ci."userId" AS uid,
               c."setId"   AS sid,
               COUNT(DISTINCT ci."cardId")::int AS owned
        FROM "CollectionItem" ci
          JOIN "Card" c ON c.id = ci."cardId"
        GROUP BY ci."userId", c."setId"
      ),
      progress AS (
        SELECT o.uid,
               o.sid,
               s.name                            AS "setName",
               s."releaseDate"                   AS "releaseDate",
               o.owned                           AS owned,
               -- ::int av samma skäl som varje COUNT ovan: en bigint blir BigInt i
               -- JS och jämförelsen mot en number kastar först vid körning.
               ${Prisma.raw(SET_FULL_TOTAL_SQL)}::int AS total
        FROM owned o
          JOIN "CardSet" s ON s.id = o.sid
          LEFT JOIN ourcnt ON ourcnt.sid = s.id
        -- ⛔ 0 = OKÄNT facit → setet får aldrig räknas som komplett. Se ovan.
        WHERE s."totalCardsFull" > 0
      )
      SELECT uid AS "userId", sid AS "setId", "setName", owned, total
      FROM progress
      WHERE total > 0 AND owned >= total
      ORDER BY uid, "releaseDate" ASC NULLS LAST, sid
    `
  );

  const byUser = new Map<string, CompletedSetRow[]>();
  for (const r of rows) {
    const list = byUser.get(r.userId);
    if (list) list.push(r);
    else byUser.set(r.userId, [r]);
  }
  return byUser;
}

/**
 * ÖGONBLICKSBILDEN AV SKÄLET.
 *
 * ⛔ Skälet skrivs NÄR BESLUTET FATTAS, aldrig i efterhand. Samma regel som
 * `Alert.reasonSetName` bär: setet kan ha bytt namn, posterna kan vara sålda, och
 * en härledd förklaring påstår då fel anledning med full självsäkerhet.
 *
 * `fullt_set` pekar på det FÖRSTA kompletta setet, `setmastare` på det som tippade
 * över tröskeln (plus antalet). Övriga bär mätvärdet — det räcker för att kunna
 * skriva "du passerade 100 kort" om ett år, när siffran hunnit ändras.
 */
function metaForGrant(
  grant: AchievementGrant,
  completed: CompletedSetRow[]
): Prisma.InputJsonValue {
  if (grant.key === "fullt_set") {
    const first = completed[0];
    return first ? { setId: first.setId, setName: first.setName } : { value: grant.value };
  }
  if (grant.key === "setmastare") {
    // Index 4 = det femte kompletta setet, dvs det som tippade tröskeln.
    const tipping = completed[4] ?? completed[completed.length - 1];
    return tipping
      ? { setId: tipping.setId, setName: tipping.setName, completed: grant.value }
      : { value: grant.value };
  }
  return { value: grant.value };
}

export async function runAchievementSweep(): Promise<AchievementSweepResult> {
  // ⛔ UTC-dygn, aldrig lokal midnatt: `arsmedlem` hade annars delats ut ett dygn
  // fel beroende på var jobbet råkade köra. Actions kör UTC, så felet hade bara
  // synts vid manuella körningar — dvs aldrig, tills någon undrade.
  const today = utcToday();

  // ---- Fyra läsningar, alla över HELA basen ----
  const [metricRows, completedByUser, users, existing] = await Promise.all([
    loadMetricRows(),
    loadCompletedSets(),
    // ⛔ ALLA konton, inte bara de aktiva: `arsmedlem` och `discordare` gäller även
    // den som aldrig lagt upp ett kort. Tre små kolumner — raden är billig, och
    // ett filter hade bara flyttat urvalet till en gren som måste hållas i synk
    // med katalogen.
    withDbRetry(() =>
      prisma.user.findMany({
        select: { id: true, createdAt: true, discordUserId: true },
      })
    ),
    // ⛔ HELA tabellen i EN fråga, aldrig en per användare. 15 märken × antal
    // konton, tre små kolumner. ⚠️ Vid ~100 000 konton (≈1,5 M rader) blir den
    // här läsningen jobbets tyngsta del — då, men inte förr, ska den snävas in
    // till konton som ändrats sedan förra körningen.
    withDbRetry(() =>
      prisma.userAchievement.findMany({ select: { userId: true, key: true, tier: true } })
    ),
  ]);

  // ---- Vik ihop mätvärdena per användare (rent i minnet, noll extra frågor) ----
  const statsByUser = new Map<string, AchievementStats>();
  const statsFor = (userId: string): AchievementStats => {
    let s = statsByUser.get(userId);
    if (!s) {
      s = { ...EMPTY_STATS };
      statsByUser.set(userId, s);
    }
    return s;
  };

  for (const row of metricRows) {
    // Okänt mätvärde = en gren i SQL:en som inte längre har en motsvarighet i
    // katalogen. Hoppa över den tyst; att kasta hade fällt hela nattkörningen för
    // en rad ingen längre läser.
    if (!(row.metric in EMPTY_STATS)) continue;
    const stats = statsFor(row.userId);
    stats[row.metric as keyof AchievementStats] = row.n;
  }

  for (const [userId, list] of completedByUser) {
    statsFor(userId).completedSets = list.length;
  }

  for (const u of users) {
    const stats = statsFor(u.id);
    stats.membershipDays = daysSinceUtc(u.createdAt, today);
    // ⛔ `discordUserId`, inte `discordLinkedAt`: id:t är kopplingens IDENTITET
    // (unikt index), tidsstämpeln är bara när den skedde och kan saknas på gamla
    // rader. Vakta alltid på det fält som gör tillståndet sant.
    stats.discordLinked = u.discordUserId ? 1 : 0;
  }

  // ---- Vad är redan utdelat? ----
  const grantedByUser = new Map<string, Set<string>>();
  for (const row of existing) {
    const set = grantedByUser.get(row.userId);
    const id = grantId(row.key, row.tier);
    if (set) set.add(id);
    else grantedByUser.set(row.userId, new Set([id]));
  }

  // ---- Döm ----
  const byKey: Record<string, number> = {};
  const data: Prisma.UserAchievementCreateManyInput[] = [];
  let usersGranted = 0;

  for (const [userId, stats] of statsByUser) {
    const fresh = newGrants(
      evaluateAchievements(stats),
      grantedByUser.get(userId) ?? new Set<string>()
    );
    if (fresh.length === 0) continue;
    usersGranted++;
    const completed = completedByUser.get(userId) ?? [];
    for (const g of fresh) {
      byKey[g.key] = (byKey[g.key] ?? 0) + 1;
      data.push({
        userId,
        key: g.key,
        tier: g.tier,
        meta: metaForGrant(g, completed),
        // `announcedAt` sätts INTE — se filens topp.
      });
    }
  }

  // ---- Skriv ----
  // ⛔ `skipDuplicates: true` mot `@@unique([userId, key, tier])` ÄR idempotensen.
  // Diffen ovan är bara en snabbväg; två samtidiga körningar (en manuell omkörning
  // ovanpå nattjobbet) ser samma "redan utdelat"-lista och kan inte filtrera bort
  // varandras rader. Databasen är vakten.
  let granted = 0;
  for (let i = 0; i < data.length; i += CREATE_CHUNK) {
    const chunk = data.slice(i, i + CREATE_CHUNK);
    const res = await withDbRetry(() =>
      prisma.userAchievement.createMany({ data: chunk, skipDuplicates: true })
    );
    granted += res.count;
  }

  const summary = ACHIEVEMENTS.filter((a) => byKey[a.key])
    .map((a) => `${a.key}=${byKey[a.key]}`)
    .join(" · ");
  console.log(
    `[achievements] ${users.length} konton · ${granted} nya märken till ${usersGranted} konton` +
      (summary ? ` · ${summary}` : " · inget nytt")
  );

  return { users: users.length, usersGranted, granted, byKey };
}
