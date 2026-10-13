/**
 * GIVEAWAY MED LOTTER (ägarbeslut 2026-10-13). Ren modell — ingen DB, testad i
 * tests/unit/giveaway.test.ts. Läsningen bor i src/services/giveaway.ts.
 *
 * Lotter (räknas vid läsning/dragning, lagras aldrig):
 *   konto (anmäld)                           5   en gång
 *   skannat kort lagt i samlingen          1/kort  max 100, unika kort, borttagna dras av
 *   inbjuden vän som blivit aktiv         10/vän  max 10 vänner (verifierad + återbesök)
 *   restock-larm på en produkt               5   en gång
 *
 * ⛔ Bara skannade kort ger lotter (ägarbeslut, samma modell som branschen kör).
 * Gratiskontots skannerkvot är lägre än Pro:s — känd avvägning, tagen av ägaren.
 * ⛔ Inget går att köpa: inga lotter för Pro, köp eller annonser.
 * ⛔ Följ/kommentera/tagga på TikTok + Instagram går inte att verifiera via API —
 * de är KRAV som kontrolleras manuellt på vinnaren, inga lotter.
 */
export interface GiveawayConfig {
  key: string;
  startsAt: Date;
  closesAt: Date;
}

/**
 * Aktuell giveaway. Start/slut kan flyttas med env utan kodändring:
 * `GIVEAWAY_CLOSES_AT` (ISO) avslutar i förtid när målet (1 000 TikTok-följare)
 * nås — sätt den ~24 h framåt och meddela det.
 */
export const GIVEAWAY_KEY = "30th-etb-2026";
const DEFAULT_STARTS_AT = "2026-10-14T00:00:00+02:00";
const DEFAULT_CLOSES_AT = "2026-11-15T23:59:59+01:00";

export const TICKETS = {
  account: 5,
  perScan: 1,
  maxScans: 100,
  perInvite: 10,
  maxInvites: 10,
  restockAlert: 5,
} as const;

export const MAX_TICKETS =
  TICKETS.account +
  TICKETS.perScan * TICKETS.maxScans +
  TICKETS.perInvite * TICKETS.maxInvites +
  TICKETS.restockAlert;

function parseDate(raw: string | undefined, fallback: string): Date {
  const d = raw ? new Date(raw) : null;
  return d && !Number.isNaN(d.getTime()) ? d : new Date(fallback);
}

export function giveawayConfig(env: Record<string, string | undefined> = process.env): GiveawayConfig {
  return {
    key: GIVEAWAY_KEY,
    startsAt: parseDate(env.GIVEAWAY_STARTS_AT, DEFAULT_STARTS_AT),
    closesAt: parseDate(env.GIVEAWAY_CLOSES_AT, DEFAULT_CLOSES_AT),
  };
}

export type GiveawayPhase = "upcoming" | "open" | "closed";

export function giveawayPhase(cfg: GiveawayConfig, now: Date): GiveawayPhase {
  if (now.getTime() < cfg.startsAt.getTime()) return "upcoming";
  if (now.getTime() > cfg.closesAt.getTime()) return "closed";
  return "open";
}

export interface TicketInput {
  joined: boolean;
  /** Unika kort skannade och tillagda under perioden, fortfarande i samlingen. */
  scannedCards: number;
  /** Inbjudna under perioden: verifierade OCH återbesökta. */
  qualifiedInvites: number;
  hasRestockAlert: boolean;
}

export interface TicketBreakdown {
  account: number;
  scans: number;
  invites: number;
  restock: number;
  total: number;
}

export function computeTickets(input: TicketInput): TicketBreakdown {
  const account = input.joined ? TICKETS.account : 0;
  const scans = Math.min(Math.max(0, input.scannedCards), TICKETS.maxScans) * TICKETS.perScan;
  const invites =
    Math.min(Math.max(0, input.qualifiedInvites), TICKETS.maxInvites) * TICKETS.perInvite;
  const restock = input.hasRestockAlert ? TICKETS.restockAlert : 0;
  return { account, scans, invites, restock, total: account + scans + invites + restock };
}

/**
 * "@Namn", "tiktok.com/@namn", "instagram.com/namn/" → "namn". null = ogiltigt.
 * Båda plattformarna tillåter bokstäver, siffror, punkt och understreck.
 */
export function normalizeHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^(www\.|m\.|vm\.)/, "");
  s = s.replace(/^(tiktok\.com|instagram\.com)\//, "");
  s = s.split(/[/?#]/)[0] ?? "";
  s = s.replace(/^@/, "");
  return /^[a-z0-9._]{2,30}$/.test(s) ? s : null;
}
