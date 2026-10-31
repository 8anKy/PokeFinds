/**
 * GIVEAWAY MED LOTTER (ägarbeslut 2026-10-13). Ren modell — ingen DB, testad i
 * tests/unit/giveaway.test.ts. Läsningen bor i src/services/giveaway.ts.
 *
 * Lotter (räknas vid läsning/dragning, lagras aldrig):
 *   konto (anmäld)                           5   en gång
 *   skannat kort lagt i samlingen          1/kort  max 100, unika kort, borttagna dras av
 *   inbjuden vän som blivit aktiv         10/vän  max 10 vänner (verifierad + återbesök)
 *   …och som också gått med i Discord      +5/vän  max 10 (ägarbeslut 2026-10-31: fler i servern);
 *                                                 vännen kopplar via "Koppla Discord", dragningen
 *                                                 kollar att vännen är kvar
 *   restock-larm på en produkt               5   en gång
 *   Discord kopplat (= med i servern)        5   en gång; dragningen kollar medlemskapet
 *   AI-gradering (klar) under perioden     3/st  max 3 — gratiskontots månadskvot, så taket
 *                                                 nås utan Pro (ägarbeslut 2026-10-13)
 *
 * ⛔ Bara skannade kort ger lotter (ägarbeslut, samma modell som branschen kör).
 * Gratiskontots skannerkvot är lägre än Pro:s — känd avvägning, tagen av ägaren.
 * ⛔ Inget går att köpa: inga lotter för Pro, köp eller annonser.
 * ⛔ Följ/kommentera/tagga på TikTok + Instagram går inte att verifiera via API —
 * de är KRAV som kontrolleras manuellt på vinnaren, inga lotter.
 */
export interface GiveawayConfig {
  key: string;
  /** När giveawayn blir SYNLIG (före den: 404 + ingen Mer-rad för alla utom admin). */
  startsAt: Date;
  /**
   * Från när aktivitet RÄKNAS (skanningar, inbjudningar, graderingar). Skild från
   * `startsAt` sedan 2026-10-23: giveawayn var öppen 10-23 och doldes sedan igen till 10-26
   * (ägarbeslut) — det som hann göras från 10-23 ska inte gå förlorat. Aldrig senare än startsAt.
   */
  countsFrom: Date;
  closesAt: Date;
}

/**
 * Aktuell giveaway. Start/slut kan flyttas med env utan kodändring
 * (`GIVEAWAY_STARTS_AT` flyttar även när den blir synlig):
 * `GIVEAWAY_CLOSES_AT` (ISO) avslutar i förtid när målet (1 000 TikTok-följare)
 * nås — sätt den ~24 h framåt och meddela det.
 */
export const GIVEAWAY_KEY = "30th-etb-2026";
// Start = dagen ägaren tillkännager (2026-10-26, ägarbeslut — flyttad från 10-15, 10-17, 10-20 och 10-23). Före starten är
// giveawayn DOLD för alla utom admin (sidan 404:ar, Mer-raden syns inte).
const DEFAULT_STARTS_AT = "2026-10-26T00:00:00+01:00";
// Giveawayn var ÖPPEN 2026-10-23 innan den doldes igen ⇒ aktivitet räknas därifrån.
const DEFAULT_COUNTS_FROM = "2026-10-23T00:00:00+02:00";
const DEFAULT_CLOSES_AT = "2026-11-15T23:59:59+01:00";

export const TICKETS = {
  account: 5,
  perScan: 1,
  maxScans: 100,
  perInvite: 10,
  maxInvites: 10,
  perInviteDiscord: 5,
  restockAlert: 5,
  discord: 5,
  perGrading: 3,
  maxGradings: 3,
} as const;

export const MAX_TICKETS =
  TICKETS.account +
  TICKETS.perScan * TICKETS.maxScans +
  TICKETS.perInvite * TICKETS.maxInvites +
  TICKETS.perInviteDiscord * TICKETS.maxInvites +
  TICKETS.restockAlert +
  TICKETS.discord +
  TICKETS.perGrading * TICKETS.maxGradings;

function parseDate(raw: string | undefined, fallback: string): Date {
  const d = raw ? new Date(raw) : null;
  return d && !Number.isNaN(d.getTime()) ? d : new Date(fallback);
}

export function giveawayConfig(env: Record<string, string | undefined> = process.env): GiveawayConfig {
  const startsAt = parseDate(env.GIVEAWAY_STARTS_AT, DEFAULT_STARTS_AT);
  return {
    key: GIVEAWAY_KEY,
    startsAt,
    countsFrom: new Date(Math.min(parseDate(env.GIVEAWAY_COUNTS_FROM, DEFAULT_COUNTS_FROM).getTime(), startsAt.getTime())),
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
  /** Av de inbjudna ovan: hur många som också kopplat Discord (= gått med i servern). */
  invitesInDiscord: number;
  hasRestockAlert: boolean;
  /** Discord-kontot kopplat via "Koppla Discord" (som lägger in personen i servern). */
  discordLinked: boolean;
  /** Klara AI-graderingar under perioden. */
  gradings: number;
}

export interface TicketBreakdown {
  account: number;
  scans: number;
  invites: number;
  inviteDiscord: number;
  restock: number;
  discord: number;
  grading: number;
  total: number;
}

export function computeTickets(input: TicketInput): TicketBreakdown {
  const account = input.joined ? TICKETS.account : 0;
  const scans = Math.min(Math.max(0, input.scannedCards), TICKETS.maxScans) * TICKETS.perScan;
  const invites =
    Math.min(Math.max(0, input.qualifiedInvites), TICKETS.maxInvites) * TICKETS.perInvite;
  const inviteDiscord =
    Math.min(Math.max(0, input.invitesInDiscord), input.qualifiedInvites, TICKETS.maxInvites) *
    TICKETS.perInviteDiscord;
  const restock = input.hasRestockAlert ? TICKETS.restockAlert : 0;
  const discord = input.discordLinked ? TICKETS.discord : 0;
  const grading = Math.min(Math.max(0, input.gradings), TICKETS.maxGradings) * TICKETS.perGrading;
  return {
    account,
    scans,
    invites,
    inviteDiscord,
    restock,
    discord,
    grading,
    total: account + scans + invites + inviteDiscord + restock + discord + grading,
  };
}

