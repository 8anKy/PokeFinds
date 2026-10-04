/**
 * Medlemmarnas röster på en butiksrapport (ägarbeslut 2026-10-05). Ren modul —
 * delas av API, Discord-inlägget och flödet så att alla säger samma sak.
 *
 * CONFIRM = rapporten stämmer fortfarande, DISPUTE = den gör det inte längre.
 * Betydelsen beror på rapporten: på "Finns på hyllan" är det Finns kvar / Inte kvar,
 * på "Slut" är det Fortfarande slut / Finns igen.
 */
export const STORE_REPORT_VOTES = ["CONFIRM", "DISPUTE"] as const;
export type StoreReportVote = (typeof STORE_REPORT_VOTES)[number];

export interface VoteTally {
  confirmCount: number;
  disputeCount: number;
  /** Senaste rösten — den färskaste signalen om hyllan just nu. */
  lastVote: { kind: StoreReportVote; at: string } | null;
}

export function tallyVotes(votes: { kind: string; createdAt: Date }[]): VoteTally {
  let confirmCount = 0;
  let disputeCount = 0;
  let last: { kind: StoreReportVote; createdAt: Date } | null = null;
  for (const v of votes) {
    const kind: StoreReportVote = v.kind === "DISPUTE" ? "DISPUTE" : "CONFIRM";
    if (kind === "DISPUTE") disputeCount++;
    else confirmCount++;
    if (!last || v.createdAt > last.createdAt) last = { kind, createdAt: v.createdAt };
  }
  return { confirmCount, disputeCount, lastVote: last ? { kind: last.kind, at: last.createdAt.toISOString() } : null };
}

/** Översättningsnyckel (LocalStores) för knappen/räknaren, efter rapportens status. */
export function voteLabelKey(observation: string, kind: StoreReportVote): string {
  const soldOut = observation === "SOLD_OUT";
  if (kind === "CONFIRM") return soldOut ? "voteStillSoldOut" : "voteStillThere";
  return soldOut ? "voteBackInStock" : "voteGone";
}

/** Svensk etikett för Discord-inlägget (kanalen är svensk). */
export function voteLabelSv(observation: string, kind: StoreReportVote): string {
  return {
    voteStillThere: "finns kvar",
    voteGone: "inte kvar",
    voteStillSoldOut: "fortfarande slut",
    voteBackInStock: "finns igen",
  }[voteLabelKey(observation, kind)]!;
}
