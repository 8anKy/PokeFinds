/**
 * REGLERNA FÖR VAD LÄNK-REVISIONEN FÅR DÖMA OM EN BUTIKSLÄNK.
 *
 * Bor här och inte i `scripts/audit-links.ts` för att de är TESTBARA påståenden om
 * data, inte rapportformatering — och för att just de här två besluten är de enda i
 * revisionen som kan RADERA något. Se tests/unit/link-audit-policy.test.ts.
 */

/**
 * ⛔ "BUTIKEN VÄGRADE SVARA" ÄR INTE "LÄNKEN ÄR DÖD".
 *
 * Samma skillnad som `check-store-health.ts` gör på 0 produkter: 404/410 betyder att
 * sidan är BORTA, medan 401/403/407/451 betyder att butikens brandvägg/WAF sa nej till
 * OSS — sidan kan vara fullt frisk för en riktig besökare.
 *
 * MÄTT 2026-08-25: alla nio Leksaksaffären-länkar som veckorapporten listade under
 * "SÄKRA fel" svarade HTTP 200 från en vanlig IP med vår egen FoilioBot-UA. De var 403
 * enbart för att butiken spärrar GitHub Actions egress-IP. De låg alltså först i den hög
 * en människa bulk-rensar, och en rensning hade tagit bort nio fungerande köplänkar.
 *
 * ⛔ 429 hör INTE hit: den betyder "för fort", inte "nej till dig", och har redan gjort
 *    sina omförsök när vi kommer hit.
 */
export const REFUSAL_CODES: ReadonlySet<number> = new Set([401, 403, 407, 451]);

export function isStoreRefusal(status: number): boolean {
  return REFUSAL_CODES.has(status);
}

/** Sidan är verifierat borta — den enda grunden för att kalla en länk död. */
export function isDeadStatus(status: number): boolean {
  return status === 404 || status === 410;
}

/** Standard: en rad måste ha varit ur feeden i en vecka innan den får rensas. */
export const PRUNE_MIN_STALE_DAYS = 7;

/**
 * AUTO-RENSNING KRÄVER TVÅ OBEROENDE, MÄTTA SIGNALER (ägarbeslut 2026-08-25) — aldrig
 * en, och ingen av dem tolkad (samma doktrin som `.claude/rules/scraping-restock.md`:
 * frånvaro ur feeden KOLLAS, den gissas inte):
 *
 *   1. Raden har fallit UR BUTIKENS FEED — `lastSeenAt` äldre än `minStaleDays`.
 *   2. Sidan svarar verifierat 404/410 vid en FÄRSK hämtning i den här körningen.
 *
 * Tillsammans ger de "två röda veckor" utan en ny tabell, en migration eller en enda
 * extra DB-skrivning per körning (Neons nota är vaken tid). En vara som avlistades i
 * går har färsk `lastSeenAt` ⇒ rapporteras, men rensas tidigast nästa vecka. En sida
 * som 404:ar av en tillfällig ombyggnad hinner läka innan något raderas.
 *
 * ⛔ En AVVISAD länk (403) får aldrig nå hit — den är per definition inte `dead`.
 */
export function isPrunableDeadLink(args: {
  dead: boolean;
  lastSeenAt: Date;
  now: Date;
  minStaleDays?: number;
}): boolean {
  if (!args.dead) return false;
  const days = args.minStaleDays ?? PRUNE_MIN_STALE_DAYS;
  return args.lastSeenAt.getTime() < args.now.getTime() - days * 86_400_000;
}
