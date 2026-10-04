/**
 * PRENUMERATIONSHISTORIK UR AUDITLOGGEN — vem sa upp och när, vem slutade, vem
 * kom tillbaka och hur många månader i rad de betalat (ägarönskemål 2026-10-04).
 *
 * User-kolumnerna bär bara NULÄGET (`rcWillRenew`, `stripeCancelAtPeriodEnd`):
 * datumet för en uppsägning och allt om tidigare kunder finns bara i de rader
 * webhookarna redan skriver (`user.plan.revenuecat` / `user.plan.stripe`). Den
 * här modulen viker ihop dem till en historik per konto. Ren och testad — ingen
 * DB, ingen ny kolumn, ingen ny skrivning.
 *
 * ⛔ Ett SANDBOX-event är en testare, inte en kund, och hoppas över helt.
 * ⛔ "Betalar nu?" avgörs ALDRIG här — det är `payingUserWhere()`. Historiken
 *    ger bara datumen och räknarna; en tappad webhook får inte flytta en kund
 *    mellan listorna.
 */

export const SUBSCRIPTION_AUDIT_ACTIONS = ["user.plan.revenuecat", "user.plan.stripe"] as const;

export interface SubscriptionAuditRow {
  action: string;
  createdAt: Date;
  metadata: unknown;
}

export interface SubscriptionHistory {
  /** Första betalda starten vi sett. */
  firstStartAt: Date | null;
  /** Start på den nuvarande (eller senaste) obrutna perioden. */
  runStartAt: Date | null;
  /** Betalda månader i den nuvarande obrutna perioden — "streaken". */
  periodsInRun: number;
  /** Betalda månader totalt, över alla perioder. */
  totalPeriods: number;
  /** Senaste uppsägningen (auto-förnyelse av). */
  lastCancelAt: Date | null;
  /**
   * Uppsägningen syntes först i bakfyllnaden 2026-09-02, så det riktiga datumet
   * är okänt — bara att det var SENAST då. Visas som "≤ datum".
   */
  lastCancelApprox: boolean;
  /** Senaste gången Pro faktiskt tog slut. */
  lastEndAt: Date | null;
  /** Antal gånger kunden kommit tillbaka: ny start efter ett slut, eller ångrad uppsägning. */
  comebacks: number;
  lastComebackAt: Date | null;
  /** Aktiv enligt eventen. Bara för vikningen — se filhuvudet. */
  active: boolean;
}

/** Ett periodhopp under så här många dygn är en ändring i samma period, inte en förnyelse. */
const RENEWAL_JUMP_MS = 7 * 864e5;

function record(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
}

function isoDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function emptyHistory(): SubscriptionHistory {
  return {
    firstStartAt: null,
    runStartAt: null,
    periodsInRun: 0,
    totalPeriods: 0,
    lastCancelAt: null,
    lastCancelApprox: false,
    lastEndAt: null,
    comebacks: 0,
    lastComebackAt: null,
    active: false,
  };
}

/** Viker en kunds webhook-rader (valfri ordning) till en historik. */
export function subscriptionHistory(rows: SubscriptionAuditRow[]): SubscriptionHistory {
  const h = emptyHistory();
  let cancelled = false;

  const start = (at: Date) => {
    if (h.active) return; // dubblerad start (checkout + created) eller produktbyte
    if (h.firstStartAt) {
      h.comebacks += 1;
      h.lastComebackAt = at;
    } else {
      h.firstStartAt = at;
    }
    h.active = true;
    cancelled = false;
    h.runStartAt = at;
    h.periodsInRun = 1;
    h.totalPeriods += 1;
  };
  const renew = (at: Date) => {
    if (!h.active) return start(at); // återköp efter att Pro löpt ut
    h.periodsInRun += 1;
    h.totalPeriods += 1;
    cancelled = false; // en förnyelse ÄR ett svar på frågan "förnyas den?"
  };
  const cancel = (at: Date, approx = false) => {
    if (!h.active || cancelled) return;
    cancelled = true;
    h.lastCancelAt = at;
    h.lastCancelApprox = approx;
  };
  const uncancel = (at: Date) => {
    if (!h.active) return start(at);
    if (!cancelled) return;
    cancelled = false;
    h.comebacks += 1;
    h.lastComebackAt = at;
  };
  const end = (at: Date) => {
    if (!h.active) return;
    h.active = false;
    cancelled = false;
    h.lastEndAt = at;
  };

  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const row of sorted) {
    const m = record(row.metadata);
    const at = row.createdAt;

    if (row.action === "user.plan.revenuecat") {
      if (m.environment === "SANDBOX") continue;
      switch (m.event) {
        case "INITIAL_PURCHASE":
          start(at);
          break;
        case "RENEWAL":
          renew(at);
          break;
        case "CANCELLATION":
          cancel(at);
          break;
        case "UNCANCELLATION":
          uncancel(at);
          break;
        case "EXPIRATION":
          end(at);
          break;
        // Engångsbakfyllnaden 2026-09-02: säger att kunden sagt upp, inte när.
        case "DASHBOARD_BACKFILL":
          if (m.willRenew === false) cancel(at, true);
          break;
      }
      continue;
    }

    if (row.action === "user.plan.stripe") {
      const to = isoDate(m.to);
      const from = isoDate(m.from);
      if (!to) {
        end(at);
        continue;
      }
      if (!h.active) {
        start(at);
      } else if (from && to.getTime() - from.getTime() > RENEWAL_JUMP_MS) {
        renew(at);
      }
      if (m.cancelAtPeriodEnd === true) cancel(at);
      else if (m.cancelAtPeriodEnd === false) uncancel(at);
    }
  }
  return h;
}

/** Grupperar rader per konto och viker varje grupp. */
export function subscriptionHistories(
  rows: (SubscriptionAuditRow & { userId: string | null })[]
): Map<string, SubscriptionHistory> {
  const byUser = new Map<string, SubscriptionAuditRow[]>();
  for (const r of rows) {
    if (!r.userId) continue; // raderat konto
    const list = byUser.get(r.userId);
    if (list) list.push(r);
    else byUser.set(r.userId, [r]);
  }
  const out = new Map<string, SubscriptionHistory>();
  for (const [userId, list] of byUser) out.set(userId, subscriptionHistory(list));
  return out;
}
