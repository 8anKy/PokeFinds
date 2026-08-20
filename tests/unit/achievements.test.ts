import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  EMPTY_STATS,
  achievementByKey,
  achievementOrder,
  daysSinceUtc,
  evaluateAchievements,
  grantId,
  isProfitableSale,
  newGrants,
  thresholdFor,
  tiersEarned,
  type AchievementGrant,
  type AchievementStats,
} from "@/lib/achievements";

/**
 * Katalogen och domen är ren logik med FLIT — hela poängen med att de ligger i
 * `src/lib/achievements.ts` och inte i jobbet är att trösklarna går att bevisa
 * utan databas. Aggregaten (SQL:en) testas inte här; den delen har inget facit
 * utan en riktig databas, och en mock av Prisma hade bara bevisat att mocken
 * fungerar.
 */

const stats = (over: Partial<AchievementStats> = {}): AchievementStats => ({
  ...EMPTY_STATS,
  ...over,
});

/** Bekvämlighet: vilka (märke, nivå) ett mätvärdespaket ger. */
const idsFor = (over: Partial<AchievementStats>): string[] =>
  evaluateAchievements(stats(over)).map((g) => grantId(g.key, g.tier));

describe("katalogen", () => {
  it("har exakt 15 märken", () => {
    expect(ACHIEVEMENTS).toHaveLength(15);
  });

  it("har unika nycklar — de LAGRAS, en krock hade slagit ihop två märken", () => {
    const keys = ACHIEVEMENTS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("använder bara slugar: gemener, siffror och understreck", () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.key, a.key).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it("har trösklar i STIGANDE ordning — annars delas nivå 3 ut före nivå 2", () => {
    for (const a of ACHIEVEMENTS) {
      const sorted = [...a.tiers].sort((x, y) => x - y);
      expect(a.tiers, a.key).toEqual(sorted);
      expect(a.tiers.length, a.key).toBeGreaterThan(0);
      expect(a.tiers[0], a.key).toBeGreaterThan(0);
    }
  });

  it("dömer bara på mätvärden som finns i AchievementStats", () => {
    for (const a of ACHIEVEMENTS) {
      expect(Object.keys(EMPTY_STATS), a.key).toContain(a.metric);
    }
  });

  it("håller ikon och i18n-nycklar ifyllda (UI:t har inget att falla tillbaka på)", () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.icon, a.key).toMatch(/^Icon[A-Za-z]+$/);
      expect(a.labelKey, a.key).toBe(`${a.key}.name`);
      expect(a.descKey, a.key).toBe(`${a.key}.desc`);
    }
  });

  it("bär ingen svensk text — namnen bor i i18n, inte i koden", () => {
    const blob = JSON.stringify(ACHIEVEMENTS);
    expect(blob).not.toMatch(/[åäöÅÄÖ]/);
  });

  it("slår upp nycklar och nivåer, och svarar undefined/null på okända", () => {
    expect(achievementByKey("samlare")?.tiers).toEqual([10, 100, 1000]);
    expect(achievementByKey("finns_inte")).toBeUndefined();
    expect(achievementOrder("finns_inte")).toBe(-1);

    const samlare = achievementByKey("samlare")!;
    expect(thresholdFor(samlare, 1)).toBe(10);
    expect(thresholdFor(samlare, 3)).toBe(1000);
    // Nivå 4 finns inte — läsvägen ska kunna skilja det från tröskeln 0.
    expect(thresholdFor(samlare, 4)).toBeNull();
  });
});

describe("tiersEarned", () => {
  const samlare = achievementByKey("samlare")!;

  it("ger inget under första tröskeln", () => {
    expect(tiersEarned(samlare, 0)).toEqual([]);
    expect(tiersEarned(samlare, 9)).toEqual([]);
  });

  it("tröskeln är INKLUSIVE — exakt 10 poster räcker", () => {
    expect(tiersEarned(samlare, 10)).toEqual([1]);
  });

  it("ger ALLA klarade nivåer, inte bara den högsta", () => {
    // En importerad samling går från 0 till 1 200 mellan två nattkörningar.
    // Får hen bara nivå 3 saknas nivå 1 och 2 för alltid.
    expect(tiersEarned(samlare, 1200)).toEqual([1, 2, 3]);
    expect(tiersEarned(samlare, 100)).toEqual([1, 2]);
  });
});

describe("trösklarna per märke", () => {
  it("forsta_kortet kräver EN post, inte noll", () => {
    expect(idsFor({ collectionLots: 0 })).not.toContain("forsta_kortet#1");
    expect(idsFor({ collectionLots: 1 })).toContain("forsta_kortet#1");
  });

  it("samlare trappar 10 / 100 / 1000 på ANTAL POSTER (lots)", () => {
    expect(idsFor({ collectionLots: 9 })).not.toContain("samlare#1");
    expect(idsFor({ collectionLots: 10 })).toContain("samlare#1");
    expect(idsFor({ collectionLots: 100 })).toContain("samlare#2");
    expect(idsFor({ collectionLots: 999 })).not.toContain("samlare#3");
    expect(idsFor({ collectionLots: 1000 })).toContain("samlare#3");
  });

  it("setjagare trappar 5 / 25 olika set", () => {
    expect(idsFor({ distinctSets: 4 })).not.toContain("setjagare#1");
    expect(idsFor({ distinctSets: 5 })).toContain("setjagare#1");
    expect(idsFor({ distinctSets: 24 })).not.toContain("setjagare#2");
    expect(idsFor({ distinctSets: 25 })).toContain("setjagare#2");
  });

  it("fullt_set ges vid FÖRSTA kompletta setet, setmastare först vid det femte", () => {
    const one = idsFor({ completedSets: 1 });
    expect(one).toContain("fullt_set#1");
    expect(one).not.toContain("setmastare#1");

    const four = idsFor({ completedSets: 4 });
    expect(four).not.toContain("setmastare#1");

    const five = idsFor({ completedSets: 5 });
    expect(five).toContain("setmastare#1");
    // ⛔ Båda dömer på samma mätvärde — det första märket får inte försvinna när
    // det andra dyker upp.
    expect(five).toContain("fullt_set#1");
  });

  it("skanningsmärkena delar mätvärde: 1 respektive 100", () => {
    expect(idsFor({ scans: 1 })).toEqual(["forsta_skanningen#1"]);
    const veteran = idsFor({ scans: 100 });
    expect(veteran).toContain("forsta_skanningen#1");
    expect(veteran).toContain("skannarveteran#1");
    expect(idsFor({ scans: 99 })).not.toContain("skannarveteran#1");
  });

  it("forsta_graderingen räknar allt som inte havererat", () => {
    expect(idsFor({ gradings: 1 })).toContain("forsta_graderingen#1");
    expect(idsFor({ gradings: 0 })).not.toContain("forsta_graderingen#1");
  });

  it("bevakaren kräver 10 bevakningar", () => {
    expect(idsFor({ watchlistItems: 9 })).toEqual([]);
    expect(idsFor({ watchlistItems: 10 })).toEqual(["bevakaren#1"]);
  });

  it("prisjagare kräver ett larm som FAKTISKT gått iväg", () => {
    expect(idsFor({ sentAlerts: 1 })).toEqual(["prisjagare#1"]);
  });

  it("arsmedlem mäts i DYGN och ges på dag 365, inte dag 364", () => {
    expect(idsFor({ membershipDays: 364 })).toEqual([]);
    expect(idsFor({ membershipDays: 365 })).toEqual(["arsmedlem#1"]);
  });

  it("discordare är ett ja/nej uttryckt som 0/1", () => {
    expect(idsFor({ discordLinked: 0 })).toEqual([]);
    expect(idsFor({ discordLinked: 1 })).toEqual(["discordare#1"]);
  });

  it("fadder kräver TRE verifierade inbjudningar — samma tal som Pro-belöningen", () => {
    expect(idsFor({ verifiedInvites: 2 })).toEqual([]);
    expect(idsFor({ verifiedInvites: 3 })).toEqual(["fadder#1"]);
  });

  it("ett tomt konto får INGENTING (nollor är inga prestationer)", () => {
    expect(evaluateAchievements(stats())).toEqual([]);
  });

  it("bär mätvärdet vid utdelningen — ögonblicksbilden av skälet", () => {
    const granted = evaluateAchievements(stats({ collectionLots: 137 }));
    const samlare = granted.find((g) => g.key === "samlare" && g.tier === 2);
    expect(samlare?.value).toBe(137);
  });
});

describe("isProfitableSale", () => {
  it("kräver att BÅDA beloppen är kända — okänt inköpspris är inte noll", () => {
    // Merparten av samlingen saknar kostnadsbas med flit. `null → 0` hade gjort
    // varje försäljning till en vinstaffär.
    expect(isProfitableSale(null, 50_000)).toBe(false);
    expect(isProfitableSale(undefined, 50_000)).toBe(false);
    expect(isProfitableSale(30_000, null)).toBe(false);
  });

  it("vinst = strikt över inköpspriset, i ÖREN", () => {
    expect(isProfitableSale(30_000, 30_001)).toBe(true);
    expect(isProfitableSale(30_000, 30_000)).toBe(false);
    expect(isProfitableSale(30_000, 29_999)).toBe(false);
  });

  it("0 öre ÄR ett inköpspris här (draget ur ett paket), till skillnad från 0 kr som PRIS", () => {
    expect(isProfitableSale(0, 1)).toBe(true);
    expect(isProfitableSale(0, 0)).toBe(false);
  });
});

describe("daysSinceUtc", () => {
  it("räknar hela UTC-dygn", () => {
    expect(daysSinceUtc(new Date("2026-08-01T00:00:00Z"), new Date("2026-08-02T00:00:00Z"))).toBe(1);
    expect(daysSinceUtc(new Date("2025-08-20T12:00:00Z"), new Date("2026-08-20T00:00:00Z"))).toBe(
      365
    );
  });

  it("⛔ dygnsgränsen är UTC, aldrig lokal midnatt", () => {
    // 23:30Z den 1:a är fortfarande den 1:a i UTC — men den 2:a i svensk sommartid.
    // Med lokal midnatt hade svaret blivit 0 här och märket kommit ett dygn fel.
    expect(daysSinceUtc(new Date("2026-08-01T23:30:00Z"), new Date("2026-08-02T00:30:00Z"))).toBe(1);
  });

  it("klampar till 0 — ett konto skapat i framtiden ger inga negativa dygn", () => {
    expect(daysSinceUtc(new Date("2026-09-01T00:00:00Z"), new Date("2026-08-20T00:00:00Z"))).toBe(0);
  });
});

describe("idempotens (newGrants)", () => {
  const earned: AchievementGrant[] = [
    { key: "forsta_kortet", tier: 1, value: 1 },
    { key: "samlare", tier: 1, value: 12 },
  ];

  it("delar ut allt när ingenting finns sedan tidigare", () => {
    expect(newGrants(earned, [])).toHaveLength(2);
  });

  it("⛔ EN ANDRA KÖRNING SKRIVER INGENTING — annars firas märket om varje natt", () => {
    const already = earned.map((g) => grantId(g.key, g.tier));
    expect(newGrants(earned, already)).toEqual([]);
  });

  it("delar bara ut det som saknas när trappan växer", () => {
    const now: AchievementGrant[] = [
      ...earned,
      { key: "samlare", tier: 2, value: 120 },
    ];
    const fresh = newGrants(now, ["forsta_kortet#1", "samlare#1"]);
    expect(fresh.map((g) => grantId(g.key, g.tier))).toEqual(["samlare#2"]);
  });

  it("fäller dubbletter i INDATA — samma createMany får aldrig krocka med sig själv", () => {
    const dupes: AchievementGrant[] = [
      { key: "fadder", tier: 1, value: 3 },
      { key: "fadder", tier: 1, value: 4 },
    ];
    expect(newGrants(dupes, [])).toHaveLength(1);
  });

  it("grantId speglar @@unique([userId, key, tier]) — nivån MÅSTE ingå", () => {
    expect(grantId("samlare", 1)).not.toBe(grantId("samlare", 2));
  });
});

/**
 * ⛔ SCHEMALÄGGNINGEN ÄR DET SOM FÖRSVINNER TYST I DET HÄR REPOT. Nattkedjan har
 * redan tappat ett helt jobb i två månader utan en enda röd körning (led 4 fyrar
 * aldrig), och `cron-chain-sync.test.ts` finns just därför. Svepet ligger som ett
 * STEG i scrape-all.yml — försvinner steget slutar märken delas ut, ingenting blir
 * rött, och det syns först när någon undrar varför trappan står still.
 */
describe("nattlig schemaläggning", () => {
  const workflow = readFileSync(
    resolve(__dirname, "../../.github/workflows/scrape-all.yml"),
    "utf8"
  );

  it("scrape-all.yml kör utmärkelsesvepet", () => {
    expect(workflow).toMatch(/scripts\/achievement-sweep-run\.ts/);
  });

  it("steget fäller aldrig insamlingen (continue-on-error)", () => {
    const step = workflow.slice(workflow.indexOf("Dela ut utmärkelser"));
    expect(step.slice(0, 200)).toMatch(/continue-on-error:\s*true/);
  });

  it("⛔ INGEN EGEN CRON och ingen fjärde workflow_run-länk för utmärkelser", () => {
    // En egen start hade varit ytterligare en Neon-väckning à minst 300 s, och ett
    // fjärde kedjeled fyrar ALDRIG. Enda klockan i kedjan är scrape-alls 02:00.
    expect(workflow.match(/^\s*- cron:/gm) ?? []).toHaveLength(1);
  });
});
