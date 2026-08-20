/**
 * UTMÄRKELSERNAS KATALOG — ren logik, noll beroenden.
 *
 * ⛔ **INGEN PRISMA-IMPORT HÄR, NÅGONSIN.** Hela poängen med att katalogen är en
 * egen fil är att trösklarna och domen går att bevisa i en enhetstest utan
 * databas — samma skäl som `lib/collection-lots.ts` och `evaluateStockFlap`
 * ligger utanför sina jobb. Aggregaten (den dyra delen) bor i
 * `src/jobs/achievement-sweep.ts`, domen (den lätta att ha fel i) bor här.
 *
 * ⛔ **INGEN SVENSK TEXT HÄR.** `key` är en stabil slug som lagras i databasen och
 * `labelKey`/`descKey` pekar in i i18n-namnrymden `Achievements`. Lägger man
 * namnet i koden är märket låst till ett språk, och en omformulering av copyn
 * blir en datamigration. Se `UserAchievement.key` i schema.prisma.
 *
 * ⛔ **INGEN DAGLIG SVIT ("logga in N dagar i rad").** Det finns ingen historik
 * över inloggningar att räkna på, och det är ett MEDVETET val i tre lager:
 * `AnalyticsEvent` bär inget `userId`, `/api/track` rör aldrig databasen, och
 * `User.lastSeenAt` är ±15 min ungefärlig just för att slippa en skrivning per
 * session (se `.claude/rules/admin-ops.md`). En svit hade krävt exakt den
 * skrivningen — en Neon-väckning à minst 300 s debiterad tid för ett märke.
 * Bygg den inte, oavsett hur billig den ser ut i en enskild funktion.
 */

/** Katalogens identiteter. Slugar — de LAGRAS, så de får aldrig döpas om. */
export type AchievementKey =
  | "forsta_kortet"
  | "samlare"
  | "setjagare"
  | "fullt_set"
  | "setmastare"
  | "forsta_skanningen"
  | "skannarveteran"
  | "forsta_graderingen"
  | "forsta_forsaljningen"
  | "vinstaffar"
  | "bevakaren"
  | "prisjagare"
  | "arsmedlem"
  | "discordare"
  | "fadder";

/** Speglar `BadgeVariant` i `src/components/ui/badge.tsx`. Egen kopia med flit:
 *  katalogen får inte importera en klientkomponent för att förbli beroendefri. */
export type AchievementVariant = "default" | "success" | "danger" | "warning" | "info" | "holo";

/**
 * Alla mätvärden ett märke kan dömas på. HELTAL RAKT IGENOM — även det som
 * egentligen är ja/nej (`discordLinked` = 0 eller 1). Att allt är samma sorts tal
 * gör att EN jämförelse (`value >= threshold`) räcker för hela katalogen; en
 * blandning av tal och booleaner hade krävt en gren per märke, och det är i
 * grenarna felen bor.
 *
 * ⛔ Priser (`profitableSales`) räknas som ANTAL AFFÄRER, aldrig som ett belopp.
 * Belopp lagras i öre (heltal) och hör hemma i `Sale`/`formatPrice`, inte i en
 * tröskel — ett märke på "tjänat X kr" hade dessutom krävt en valutakurs vid
 * utdelningstillfället för att betyda något ett år senare.
 */
export interface AchievementStats {
  /** Antal `CollectionItem`-RADER (poster/lots), inte summerad `quantity`. */
  collectionLots: number;
  /** Antal OLIKA set man äger minst ett kort ur (sealed har inget `cardId`). */
  distinctSets: number;
  /** Antal FULLT kompletta set. Nämnaren måste vara känd — se sweepen. */
  completedSets: number;
  /** Lyckade skanningar (`ScannerJob.status = COMPLETED`). */
  scans: number;
  /** Graderingar som inte havererade (`GradingJob.status <> FAILED`). */
  gradings: number;
  sales: number;
  /** Affärer där BÅDA beloppen är kända och försäljningen gav vinst. */
  profitableSales: number;
  watchlistItems: number;
  /** Larm som FAKTISKT gått iväg (`Alert.status = SENT`). */
  sentAlerts: number;
  /** Kontots ålder i hela dygn, räknad på UTC-dygn. */
  membershipDays: number;
  /** 0/1 — Discord-kontot är kopplat. */
  discordLinked: number;
  /** Inbjudningar där den inbjudna bekräftat sin mejladress. */
  verifiedInvites: number;
}

/** Nollställda mätvärden — startpunkten för varje användare i sweepen. */
export const EMPTY_STATS: Readonly<AchievementStats> = Object.freeze({
  collectionLots: 0,
  distinctSets: 0,
  completedSets: 0,
  scans: 0,
  gradings: 0,
  sales: 0,
  profitableSales: 0,
  watchlistItems: 0,
  sentAlerts: 0,
  membershipDays: 0,
  discordLinked: 0,
  verifiedInvites: 0,
});

export type AchievementMetric = keyof AchievementStats;

export interface AchievementDef {
  key: AchievementKey;
  /** Vilket mätvärde märket dömer på. */
  metric: AchievementMetric;
  /**
   * Trösklarna, EN per nivå, STIGANDE. `tier` = index + 1, dvs `tiers[0]` är
   * nivå 1. ⛔ Ordningen är inte kosmetisk: `tiersEarned` litar på den, och en
   * fallande lista hade delat ut nivå 3 före nivå 2. Vaktat av testet.
   */
  tiers: number[];
  /** Namnet på ikonen i `src/components/ui/icons.tsx` ("IconCards"). Ren sträng —
   *  katalogen får inte importera JSX. UI:t slår upp den i sin egen tabell. */
  icon: string;
  variant: AchievementVariant;
  /** i18n-nyckel i namnrymden `Achievements`. */
  labelKey: string;
  /** i18n-nyckel i namnrymden `Achievements`. Tar `{count}` = nivåns tröskel. */
  descKey: string;
}

/**
 * KATALOGEN. 15 märken.
 *
 * ⛔ **`setmastare` HAR TRÖSKELN 5, INTE 1.** Både `fullt_set` och `setmastare`
 * dömer på SAMMA mätvärde (`completedSets`) och skiljs bara åt av tröskeln —
 * första kompletta setet respektive det femte. Skrivs de som två nivåer av samma
 * märke i stället tappar man det som gör dem värda att ha: två olika namn, två
 * olika tillfällen att fira.
 *
 * ⛔ **`vinstaffar` KRÄVER ATT BÅDA BELOPPEN ÄR KÄNDA** — `Sale.purchasePriceOre`
 * är `null` för allt som lagts in utan inköpspris (majoriteten, med flit: en
 * påhittad anskaffningskostnad gör hela siffran till en lögn, se
 * `.claude/rules/collection-portfolio.md`). Utan den vakten hade varje
 * försäljning av en post utan kostnadsbas räknats som "vinstaffär".
 */
export const ACHIEVEMENTS: readonly AchievementDef[] = Object.freeze([
  {
    key: "forsta_kortet",
    metric: "collectionLots",
    tiers: [1],
    icon: "IconCards",
    variant: "info",
    labelKey: "forsta_kortet.name",
    descKey: "forsta_kortet.desc",
  },
  {
    key: "samlare",
    metric: "collectionLots",
    tiers: [10, 100, 1000],
    icon: "IconCards",
    variant: "holo",
    labelKey: "samlare.name",
    descKey: "samlare.desc",
  },
  {
    key: "setjagare",
    metric: "distinctSets",
    tiers: [5, 25],
    icon: "IconPackage",
    variant: "info",
    labelKey: "setjagare.name",
    descKey: "setjagare.desc",
  },
  {
    key: "fullt_set",
    metric: "completedSets",
    tiers: [1],
    icon: "IconCheck",
    variant: "success",
    labelKey: "fullt_set.name",
    descKey: "fullt_set.desc",
  },
  {
    key: "setmastare",
    // ⛔ Tröskel 5 — se blockkommentaren ovan. Samma mätvärde som `fullt_set`.
    metric: "completedSets",
    tiers: [5],
    icon: "IconTrophy",
    variant: "holo",
    labelKey: "setmastare.name",
    descKey: "setmastare.desc",
  },
  {
    key: "forsta_skanningen",
    metric: "scans",
    tiers: [1],
    icon: "IconScan",
    variant: "info",
    labelKey: "forsta_skanningen.name",
    descKey: "forsta_skanningen.desc",
  },
  {
    key: "skannarveteran",
    metric: "scans",
    tiers: [100],
    icon: "IconCamera",
    variant: "holo",
    labelKey: "skannarveteran.name",
    descKey: "skannarveteran.desc",
  },
  {
    key: "forsta_graderingen",
    metric: "gradings",
    tiers: [1],
    icon: "IconShield",
    variant: "info",
    labelKey: "forsta_graderingen.name",
    descKey: "forsta_graderingen.desc",
  },
  {
    key: "forsta_forsaljningen",
    metric: "sales",
    tiers: [1],
    icon: "IconReceipt",
    variant: "info",
    labelKey: "forsta_forsaljningen.name",
    descKey: "forsta_forsaljningen.desc",
  },
  {
    key: "vinstaffar",
    metric: "profitableSales",
    tiers: [1],
    icon: "IconTrendingUp",
    variant: "success",
    labelKey: "vinstaffar.name",
    descKey: "vinstaffar.desc",
  },
  {
    key: "bevakaren",
    metric: "watchlistItems",
    tiers: [10],
    icon: "IconBell",
    variant: "warning",
    labelKey: "bevakaren.name",
    descKey: "bevakaren.desc",
  },
  {
    key: "prisjagare",
    metric: "sentAlerts",
    tiers: [1],
    icon: "IconTrendingDown",
    variant: "success",
    labelKey: "prisjagare.name",
    descKey: "prisjagare.desc",
  },
  {
    key: "arsmedlem",
    // Tröskeln är DYGN, inte år: 365 är talet som står i villkoret, och att
    // räkna om till "1" hade gömt enheten på det ställe där den betyder något.
    metric: "membershipDays",
    tiers: [365],
    icon: "IconGem",
    variant: "holo",
    labelKey: "arsmedlem.name",
    descKey: "arsmedlem.desc",
  },
  {
    key: "discordare",
    metric: "discordLinked",
    tiers: [1],
    icon: "IconMessage",
    variant: "info",
    labelKey: "discordare.name",
    descKey: "discordare.desc",
  },
  {
    key: "fadder",
    metric: "verifiedInvites",
    tiers: [3],
    icon: "IconGift",
    variant: "success",
    labelKey: "fadder.name",
    descKey: "fadder.desc",
  },
] satisfies AchievementDef[]);

/** i18n-nyckel för nivåetiketten på ett trappat märke. Tar `{tier}`. */
export const ACHIEVEMENT_TIER_LABEL_KEY = "tierLabel";

const BY_KEY = new Map<string, AchievementDef>(ACHIEVEMENTS.map((a) => [a.key, a]));

/**
 * Definitionen för en slug. `undefined` = okänd nyckel, och det är ett LEGITIMT
 * tillstånd: en rad i databasen kan bära ett märke som senare tagits ur
 * katalogen. Läsvägen ska då hoppa över raden, aldrig krascha — raden är
 * historik och får inte raderas bara för att UI:t inte längre kan rita den.
 */
export function achievementByKey(key: string): AchievementDef | undefined {
  return BY_KEY.get(key);
}

/** Katalogordningen (index) för en slug — UI:t sorterar på den. -1 för okänd. */
export function achievementOrder(key: string): number {
  return ACHIEVEMENTS.findIndex((a) => a.key === key);
}

/** Tröskeln för en viss nivå, eller `null` om nivån inte finns i katalogen. */
export function thresholdFor(def: AchievementDef, tier: number): number | null {
  const t = def.tiers[tier - 1];
  return t == null ? null : t;
}

/**
 * Nivåerna ett mätvärde förtjänar, som `[1, 2, …]`.
 *
 * ⛔ **ALLA klarade nivåer, inte bara den högsta.** Den som importerar en hel
 * samling på en gång går från 0 till 1 200 poster mellan två nattkörningar; får
 * hen bara nivå 3 saknas nivå 1 och 2 för alltid, och trappan ser trasig ut.
 * Idempotensen tar hand om resten — redan utdelade nivåer filtreras bort i
 * `newGrants`, inte här.
 */
export function tiersEarned(def: AchievementDef, value: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < def.tiers.length; i++) {
    if (value >= def.tiers[i]) out.push(i + 1);
  }
  return out;
}

export interface AchievementGrant {
  key: AchievementKey;
  tier: number;
  /** Mätvärdet VID UTDELNINGEN — går rakt in i `UserAchievement.meta`. */
  value: number;
}

/** Hela katalogen dömd mot ett mätvärdespaket. Ren funktion, ingen ordning bevarad
 *  utöver katalogens egen. */
export function evaluateAchievements(stats: AchievementStats): AchievementGrant[] {
  const out: AchievementGrant[] = [];
  for (const def of ACHIEVEMENTS) {
    const value = stats[def.metric];
    for (const tier of tiersEarned(def, value)) {
      out.push({ key: def.key, tier, value });
    }
  }
  return out;
}

/** Nyckeln som gör (märke, nivå) jämförbart. Samma form i minnet som `@@unique`
 *  i databasen — den ena är vakten, den andra är snabbvägen. */
export function grantId(key: string, tier: number): string {
  return `${key}#${tier}`;
}

/**
 * IDEMPOTENSEN, som ren logik.
 *
 * ⛔ Det här är BARA en snabbväg som håller nere antalet rader vi skickar. Den
 * riktiga garantin är `@@unique([userId, key, tier])` + `skipDuplicates` i
 * databasen — två samtidiga körningar (en manuell omkörning ovanpå nattjobbet)
 * ser samma "redan utdelat"-lista och kan inte filtrera bort varandras rader.
 * Ta aldrig bort det unika indexet för att den här funktionen finns.
 */
export function newGrants(
  earned: AchievementGrant[],
  existing: Iterable<string>
): AchievementGrant[] {
  const have = new Set(existing);
  const seen = new Set<string>();
  const out: AchievementGrant[] = [];
  for (const g of earned) {
    const id = grantId(g.key, g.tier);
    // `seen` fäller dubbletter i INDATA — en och samma körning får aldrig
    // skicka två rader som krockar med varandra i samma createMany.
    if (have.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(g);
  }
  return out;
}

/**
 * Gav affären vinst?
 *
 * ⛔ **`null` INKÖPSPRIS ÄR "VI VET INTE", ALDRIG NOLL.** Merparten av samlingen
 * saknar kostnadsbas med flit (se `.claude/rules/collection-portfolio.md`), och
 * `null → 0` hade gjort VARJE försäljning till en vinstaffär. Samma tankefel som
 * en gång lät prislösa objekt bidra med hela sitt värde som "vinst" i
 * portföljvyn.
 *
 * ⚠️ 0 öre ÄR ett giltigt inköpspris här (dragen i ett paket, fått i present) —
 * till skillnad från 0 kr som PRIS, som alltid betyder "vi vet inte". Skillnaden
 * är att beloppet är användarens egen uppgift, inte en konverterad källsiffra.
 */
export function isProfitableSale(
  purchasePriceOre: number | null | undefined,
  salePriceOre: number | null | undefined
): boolean {
  if (purchasePriceOre == null || salePriceOre == null) return false;
  return salePriceOre > purchasePriceOre;
}

/**
 * Hela dygn mellan två tidpunkter, räknat på UTC-DYGN.
 *
 * ⛔ **ALDRIG `setHours(0,0,0,0)`** — den ger LOKAL midnatt, och på svensk tid
 * skriver/läser en manuell körning då fel dygn (se `utcToday()` i
 * `src/lib/utils.ts`; det kostade en klobbrad snapshot-dag 2026-07-25). Här
 * hade felet blivit att `arsmedlem` delas ut ett dygn för tidigt eller sent
 * beroende på var jobbet råkade köra — osynligt i Actions, som kör UTC.
 */
export function daysSinceUtc(from: Date, now: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}
