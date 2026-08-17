import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_USER_DIR,
  DEFAULT_USER_SORT,
  USER_SORT_KEYS,
  isDbSortable,
  isDefaultSort,
  needsAllCosts,
  parseUserSort,
  userOrderBy,
} from "@/app/[locale]/(app)/admin/anvandare/users-sort";

/**
 * SORTERBAR ANVÄNDARLISTA I ADMIN (2026-08-17).
 *
 * De två felen som INTE syns i gränssnittet vaktas här:
 *
 * 1. **Sortering efter paginering.** Listan är serverpaginerad (25 rader). En
 *    `users.sort()` i tabellen hade kastat om sidans 25 rader och sett helt
 *    korrekt ut — "dyrast först" hade betytt "dyrast av de 25 som råkade ligga
 *    här", och det går bara att upptäcka mot databasen.
 * 2. **Icke-unik sorteringsnyckel utan sista led.** Med LIMIT/OFFSET över en
 *    kolumn där många rader delar värde (roll, plan, "0 kr") väljer Postgres
 *    ordningen inom gruppen fritt per fråga — samma användare kan dyka upp på
 *    två sidor och en annan på ingen.
 *
 * Källfilerna läses som TEXT där invarianten är strukturell: sidan är en
 * server-komponent med auth, i18n och Prisma i importkedjan, och tabellen är en
 * klientkomponent — samma avvägning som cron-chain-sync.test.ts gör.
 */
const SRC = resolve(__dirname, "../../src");
const read = (p: string) => readFileSync(resolve(SRC, p), "utf8");

const DIR = "app/[locale]/(app)/admin/anvandare";
const PAGE = read(`${DIR}/page.tsx`);
const TABLE = read(`${DIR}/users-table.tsx`);

/**
 * Kommentarer bort före de NEKANDE kontrollerna. Filerna beskriver med flit
 * felet de skyddar mot ("aldrig en `users.sort()` här"), och en regex som läser
 * den meningen som ett fynd hade gjort dokumentationen omöjlig att skriva.
 */
const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("adminlistans sortering: URL → giltig sortering", () => {
  it("utan parametrar gäller standardvyn (nyast konto först)", () => {
    expect(parseUserSort(undefined, undefined)).toEqual({
      sort: DEFAULT_USER_SORT,
      dir: DEFAULT_USER_DIR,
    });
    expect(DEFAULT_USER_SORT).toBe("created");
    expect(DEFAULT_USER_DIR).toBe("desc");
  });

  it("första klicket på en kolumn sorterar stigande", () => {
    for (const key of USER_SORT_KEYS) {
      expect(parseUserSort(key, undefined).dir, key).toBe("asc");
    }
  });

  it("okänt sorteringsvärde faller tillbaka på standard i stället för att kasta", () => {
    // ?sort=... går att gissa och länken kan delas vidare.
    expect(parseUserSort("hittepå", "desc")).toEqual({
      sort: DEFAULT_USER_SORT,
      dir: DEFAULT_USER_DIR,
    });
    expect(parseUserSort("cost", "sidledes").dir).toBe("asc");
  });

  it("bara standardvyn räknas som standard → URL:en hålls ren", () => {
    expect(isDefaultSort("created", "desc")).toBe(true);
    expect(isDefaultSort("created", "asc")).toBe(false);
    expect(isDefaultSort("cost", "desc")).toBe(false);
  });
});

describe("varje sortering ordnas FÖRE pagineringen", () => {
  it("varje nyckel hör till exakt en väg: DB-sorterad eller beräknad", () => {
    const computed = USER_SORT_KEYS.filter((k) => !isDbSortable(k));
    // Failar den här har någon gjort alla nycklar DB-sorterbara och resten av
    // testet hade då kontrollerat en tom lista.
    expect(computed).toEqual(["plan", "usage", "cost"]);
    // Och de beräknade måste faktiskt ha en egen gren i sidans rangordning —
    // annars ärver de en annan kolumns tal och sorterar tyst på fel värde.
    // (`never`-grenen i computedRank gör samma sak vid kompilering; det här
    // fångar den som "löser" typfelet genom att bredda en befintlig gren.)
    for (const key of computed) {
      expect(PAGE, `${key} saknas i computedRank()`).toContain(`case "${key}":`);
    }
  });

  it("kostnad och användning kräver kostnadsfrågan för HELA träffmängden", () => {
    // Bara sidans 25 rader hade gjort "vem kostar mest" till "mest av 25".
    expect(needsAllCosts("cost")).toBe(true);
    expect(needsAllCosts("usage")).toBe(true);
    expect(needsAllCosts("plan")).toBe(false);
    expect(PAGE).toMatch(/needsAllCosts\(sort\)[\s\S]{0,120}loadUserCosts\(/);
  });

  it("tabellen sorterar ALDRIG raderna själv", () => {
    // En klientsortering hade bara ordnat om sidans 25 rader — se filhuvudet.
    expect(codeOf(TABLE)).not.toMatch(/users\s*\.\s*(sort|toSorted)\s*\(/);
    expect(codeOf(TABLE)).not.toMatch(/\[\s*\.\.\.\s*users\s*\]\s*\.\s*sort\s*\(/);
    // Sorteringen går via URL:en, dvs servern.
    expect(TABLE).toMatch(/params\.set\("sort", nextSort\)/);
    expect(TABLE).toMatch(/params\.set\("dir", nextDir\)/);
  });

  it("en ny sortering börjar om på sida 1", () => {
    // "Sida 3 av den gamla ordningen" är ingen position i den nya.
    expect(TABLE).toMatch(/navigate\(query, 1, nextSort, nextDir\)/);
  });

  it("sidbytet behåller sorteringen", () => {
    expect(TABLE).toMatch(/onPageChange=\{\(p\) => navigate\(query, p, sort, dir\)\}/);
  });
});

describe("userOrderBy: deterministisk och med null i botten", () => {
  const dbKeys = USER_SORT_KEYS.filter(isDbSortable);

  it("varje DB-sortering slutar med ett unikt led", () => {
    expect(dbKeys.length).toBeGreaterThan(0);
    for (const key of dbKeys) {
      for (const dir of ["asc", "desc"] as const) {
        const order = userOrderBy(key, dir);
        // Utan `id` sist kan LIMIT/OFFSET tappa eller dubblera rader — se filhuvudet.
        expect(order.at(-1), `${key} ${dir}`).toEqual({ id: "asc" });
        expect(order.length, `${key} ${dir}`).toBe(2);
      }
    }
  });

  it("nullbara kolumner får null i botten, inte Postgres standardplacering", () => {
    // Postgres ordnar NULL SIST i ASC och FÖRST i DESC. "Senast sedd, senast
    // först" hade alltså inletts med alla som ALDRIG synts till.
    const nullable = ["lastSeen", "verified", "bonus"] as const;
    for (const key of nullable) {
      const [asc] = userOrderBy(key, "asc") as [Record<string, { sort: string; nulls: string }>];
      const [desc] = userOrderBy(key, "desc") as [Record<string, { sort: string; nulls: string }>];
      const field = Object.keys(asc)[0];
      expect(asc[field], `${key} asc`).toEqual({ sort: "asc", nulls: "first" });
      expect(desc[field], `${key} desc`).toEqual({ sort: "desc", nulls: "last" });
    }
  });

  it("push-enheter ordnas på relationens ANTAL", () => {
    expect(userOrderBy("devices", "desc")[0]).toEqual({ pushTokens: { _count: "desc" } });
  });

  it("rollen ordnas på enumkolumnen, dvs behörighetsstegen", () => {
    // Postgres sorterar enum på deklarationsordningen i schema.prisma
    // (USER → MODERATOR → ADMIN → SUPERADMIN), inte på bokstavsordning.
    expect(userOrderBy("role", "asc")[0]).toEqual({ role: "asc" });
    const schema = readFileSync(resolve(SRC, "../prisma/schema.prisma"), "utf8");
    const declared = /enum Role \{([^}]+)\}/.exec(schema)?.[1].trim().split(/\s+/);
    expect(declared).toEqual(["USER", "MODERATOR", "ADMIN", "SUPERADMIN"]);
  });
});

describe("planet sorteras på faktisk Pro-status, inte på planTier", () => {
  it("rangordningen går via isPro(), som väger in alla fyra källorna", () => {
    // `planTier` ensamt hade lagt en betalande Stripe-kund bland "Gratis" på en
    // rad som synligt bär brickan "Pro". Se lib/plan.ts.
    expect(PAGE).toMatch(/case "plan":\s*\n\s*return isPro\(user\)/);
    // Och raden måste bära fälten isPro() läser — ett ovalt fält blir undefined
    // och vakten failar ÖPPET.
    for (const field of ["planTier", "role", "bonusProUntil", "stripeProUntil"]) {
      expect(PAGE, `${field} måste väljas för rangordningen`).toContain(`${field}: true`);
    }
  });
});

describe("den beräknade vägen behåller sin ordning genom sista hämtningen", () => {
  it("raderna sorteras om efter id-listan, inte efter databasens `in`-ordning", () => {
    // `where: { id: { in: [...] } }` ger raderna i DATABASENS ordning. Utan
    // omsorteringen visar sidan rätt 25 användare i fel ordning — det ser ut som
    // att sorteringen "nästan" fungerar.
    expect(PAGE).toMatch(/ranked\.ids\.map\(\(id\) => byId\.get\(id\)\)/);
  });
});
