/**
 * SORTERINGEN I ADMINENS ANVÄNDARLISTA — EN SANNING FÖR SERVERN OCH TABELLEN.
 *
 * ⛔ **SORTERINGEN MÅSTE SKE FÖRE PAGINERINGEN, ALDRIG EFTER.** Listan är
 *    serverpaginerad (25 rader), så en sortering i klienten hade bara kastat om
 *    de 25 rader som råkade ligga på sidan. Resultatet SER sorterat ut — den
 *    dyraste användaren står överst — men det är den dyraste av 25, inte av
 *    alla. Ett sådant fel går inte att upptäcka i gränssnittet, bara mot
 *    databasen, vilket är exakt fel egenskap hos en kostnadsvy.
 *
 * ⛔ **NULL ÄR DET LÄGSTA VÄRDET, ÖVERALLT.** Postgres ordnar som standard NULL
 *    SIST i stigande och FÖRST i fallande, dvs "Aldrig sedd" hade inlett
 *    "senast sedd, senast först". Varje nullbart fält får därför ett uttryckligt
 *    `nulls` som gör null till botten av skalan: aldrig sedd < sedd, obekräftad
 *    < bekräftad, ingen Pro-gåva < gåva.
 *
 * ⛔ **VARJE SORTERING HAR ETT SISTA, UNIKT LED (`id`).** Med LIMIT/OFFSET över
 *    en icke-unik nyckel (roll, plan, "0 kr") väljer Postgres ordningen inom
 *    gruppen fritt per fråga — samma användare kan då dyka upp på två sidor och
 *    en annan på ingen. Samma regel som katalogfeeden, se services/products.ts.
 */
import type { Prisma } from "@prisma/client";

export type UserSortKey =
  | "name"
  | "email"
  | "verified"
  | "role"
  | "plan"
  | "bonus"
  | "devices"
  | "lastSeen"
  | "usage"
  | "cost"
  | "created";

export type SortDir = "asc" | "desc";

export const USER_SORT_KEYS: readonly UserSortKey[] = [
  "name",
  "email",
  "verified",
  "role",
  "plan",
  "bonus",
  "devices",
  "lastSeen",
  "usage",
  "cost",
  "created",
];

/** Standardvyn: nyast konto först. Oförändrad sedan innan sorteringen fanns. */
export const DEFAULT_USER_SORT: UserSortKey = "created";
export const DEFAULT_USER_DIR: SortDir = "desc";

/**
 * Sorteringar Postgres kan ordna → paginering över HELA träffmängden, en fråga.
 *
 * Resten (`plan`, `usage`, `cost`) räknas fram i JS och kan inte uttryckas i ett
 * `orderBy`: kostnaden och användningen bor i `ScannerJob`/`GradingJob` och
 * summeras med grupperad rå SQL (se services/admin/user-costs.ts), och Pro-status
 * har FYRA oberoende källor (se lib/plan.ts) — `planTier` ensamt hade lagt en
 * betalande Stripe-kund bland "Gratis" medan raden bredvid visar brickan "Pro".
 */
const DB_SORTABLE = new Set<UserSortKey>([
  "name",
  "email",
  "verified",
  "role",
  "bonus",
  "devices",
  "lastSeen",
  "created",
]);

/** De sorteringar som måste rangordnas i JS. Se DB_SORTABLE ovan. */
export type ComputedSortKey = "plan" | "usage" | "cost";

/**
 * Typpredikat, inte bara en boolean: `else`-grenen på anropsstället smalnar då
 * av till `ComputedSortKey`, och rangordningen där kan göras UTTÖMMANDE. Utan
 * det hade en ny beräknad kolumn kunnat glömmas i rangordningen och tyst ärvt
 * en annan kolumns tal — sorteringen ser ut att fungera, på fel värde.
 */
export function isDbSortable(
  sort: UserSortKey
): sort is Exclude<UserSortKey, ComputedSortKey> {
  return DB_SORTABLE.has(sort);
}

/** Sorteringar som kräver kostnadsfrågan för ALLA träffar, inte bara sidan. */
export function needsAllCosts(sort: UserSortKey): boolean {
  return sort === "cost" || sort === "usage";
}

/**
 * URL-parametrar → giltig sortering. Okända värden faller tillbaka på standard.
 *
 * Utan `sort` gäller standardvyn (nyast först). MED en kolumn vald är första
 * klicket STIGANDE — lägst/tidigast först — och andra klicket vänder. Regeln är
 * densamma för alla kolumner med flit: en kolumn som "vet bättre" och startar
 * fallande gör pilen till enda ledtråden om vad man faktiskt tittar på.
 */
export function parseUserSort(
  sort: string | undefined,
  dir: string | undefined
): { sort: UserSortKey; dir: SortDir } {
  const key = USER_SORT_KEYS.find((k) => k === sort);
  if (!key) return { sort: DEFAULT_USER_SORT, dir: DEFAULT_USER_DIR };
  return { sort: key, dir: dir === "desc" ? "desc" : "asc" };
}

/** True när sorteringen är standardvyn → parametrarna utelämnas ur URL:en. */
export function isDefaultSort(sort: UserSortKey, dir: SortDir): boolean {
  return sort === DEFAULT_USER_SORT && dir === DEFAULT_USER_DIR;
}

/**
 * Prisma-`orderBy` för de DB-sorterbara kolumnerna, alltid med `id` sist.
 *
 * ⚠️ `name` ordnas på råa kolumnen och databasens collation är C.UTF-8 — versaler
 * sorteras före gemener och "Å" hamnar efter "z". Katalogen löser samma sak med
 * en normaliserad kolumn; här är listan liten nog att en admin ser namnet ändå,
 * och en genererad kolumn på User vore en migration för en kosmetisk detalj.
 */
export function userOrderBy(
  sort: Exclude<UserSortKey, ComputedSortKey>,
  dir: SortDir
): Prisma.UserOrderByWithRelationInput[] {
  // Se filhuvudet: null ska vara skalans botten, inte Postgres standardplacering.
  const nulls = dir === "asc" ? ("first" as const) : ("last" as const);
  const tiebreak: Prisma.UserOrderByWithRelationInput = { id: "asc" };

  switch (sort) {
    case "name":
      return [{ name: dir }, tiebreak];
    case "email":
      return [{ email: dir }, tiebreak];
    case "verified":
      return [{ emailVerifiedAt: { sort: dir, nulls } }, tiebreak];
    // Enum-kolumn: Postgres ordnar på DEKLARATIONSORDNINGEN i schema.prisma
    // (USER → MODERATOR → ADMIN → SUPERADMIN), alltså behörighetsstegen — inte
    // bokstavsordning. Kastas raderna om i enumen ändras den här sorteringen med.
    case "role":
      return [{ role: dir }, tiebreak];
    case "bonus":
      return [{ bonusProUntil: { sort: dir, nulls } }, tiebreak];
    // Relationsantal: "hur många push-enheter". Noll enheter är ett riktigt 0 här
    // (raden saknas helt enkelt), så ingen null-placering behövs.
    case "devices":
      return [{ pushTokens: { _count: dir } }, tiebreak];
    case "lastSeen":
      return [{ lastSeenAt: { sort: dir, nulls } }, tiebreak];
    default:
      return [{ createdAt: dir }, tiebreak];
  }
}
