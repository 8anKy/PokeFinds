import type { StockStatus } from "@prisma/client";

/**
 * Beslutar om restock-skanningen behöver VÄCKA Neon, genom att jämföra feedens
 * lager-läge mot förra körningens — i minnet, utan DB.
 *
 * VARFÖR (kvot-kritiskt, mätt 2026-07-14): den gamla grinden (feed-fingerprint.ts)
 * frågade "ändrades feeden alls?". Roterande butiker (Swepoke/Shinycards) returnerar
 * en ANNAN delmängd URL:er varje hämtning → fingeravtrycket flippade VARJE körning →
 * 10-min-lanen väckte Neon var 10:e minut. På Launch kan computen inte somna snabbare
 * än 5 min, så varje onödig uppvakning = minst 5 min fakturerad compute.
 *
 * Den här grinden ställer rätt fråga: "flippade NÅGON URL sitt LAGER?". En URL som
 * dyker upp/försvinner (rotation) räknas INTE — bara en URL vi såg BÅDA gångerna med
 * ändrad status. Då sover Neon på rotation/prisbrus och väcks bara på riktiga händelser.
 *
 * MÅSTE spegla DB-fasens semantik EXAKT (src/scrapers/restock.ts), annars missas en
 * restock (tyst). Reglerna:
 *  - Restock-larm = OUT_OF_STOCK → IN_STOCK. MEN vi måste också väcka på IN → OOS
 *    (sellout): DB-fasen måste registrera slutförsäljningen, annars ser NÄSTA körning
 *    ingen OOS→IN-övergång och restocken larmas aldrig. Båda flipparna väcker alltså.
 *  - UNKNOWN räknas ALDRIG (isRealStockTransition kräver båda ≠ UNKNOWN).
 *  - Ny URL i lager (fanns ej förra körningen): för ICKE-roterande butiker = möjlig ny
 *    produkt → väck. För roterande = rotation, inte signal → väck INTE (samma som att
 *    roterande feeds inte ger "ny produkt"-larm i övrigt).
 *
 * Rena funktioner, inga node-builtins → unit-testbara och importeras bara av CLI-
 * wrappern + tester (ALDRIG runner.ts/restock.ts som Next buntar). Se feed-fingerprint.ts.
 */

export type FeedItemLite = { url: string; stockStatus: StockStatus };
export type FeedGroup = { sourceName: string; items: FeedItemLite[] };
/** Serialiserbar för Actions-cachen. Nyckel = `${sourceName}\t${url}` → lagerstatus. */
export type FeedStateMap = Record<string, string>;

const IN = "IN_STOCK";
const OOS = "OUT_OF_STOCK";
const keyOf = (source: string, url: string) => `${source}\t${url}`;

/** Kollapsar feeden till en url→status-karta. IN_STOCK vinner (som DB-fasens `fresh`). */
export function buildStateMap(groups: FeedGroup[]): FeedStateMap {
  const m: FeedStateMap = {};
  for (const g of groups) {
    for (const it of g.items) {
      const k = keyOf(g.sourceName, it.url);
      if (m[k] === IN) continue;
      m[k] = it.stockStatus;
    }
  }
  return m;
}

/**
 * Nästa körnings state-karta. Ersätter BARA nycklarna för källor som faktiskt
 * LEVERERADE en katalog (≥1 annons). En källa som kom tillbaka TOM lämnas orörd —
 * förra lagerläget behålls.
 *
 * VARFÖR (mätt 2026-07-25): `buildStateMap` byggde state ur BARA den här körningens
 * feed, och wrappern skriver state VARJE körning. En butik som svarade tomt (utan att
 * kasta fel — Alphaspel gör det med jämna mellanrum) raderade därför sina 71 URL:er ur
 * minnet, och NÄSTA lyckade hämtning såg hela sortimentet som `from: "ABSENT"` →
 * 71 × "ny-i-lager" → DB-fasen väcktes och gick igenom alla 1192 annonser för att hitta
 * "0 restocks, 0 nya". Det upprepades varannan körning dygnet runt och var den enskilt
 * största posten i Neon-räkningen (vaken-tid 23 % → 84 % på tre dygn).
 *
 * Tom feed = INGEN INFORMATION, inte "allt försvann". Exakt samma invariant som
 * DB-fasen redan har (`feedRetailers` kräver `items.length > 0`, runner.ts) — grinden
 * var enda stället som saknade den.
 */
export function mergeStateMap(prev: FeedStateMap, groups: FeedGroup[]): FeedStateMap {
  const next: FeedStateMap = { ...prev };
  const delivered = groups.filter((g) => g.items.length > 0);

  // Rensa FÖRST alla levererande källors gamla nycklar, skriv sedan de vi såg nu. Då
  // blir "IN_STOCK vinner" nedan en jämförelse mot bara den här körningens rader, och
  // en URL som försvunnit ur en LYCKAD feed glöms (= möjlig ny produkt om den kommer
  // tillbaka i lager, samma semantik som förut).
  for (const g of delivered) {
    const prefix = `${g.sourceName}\t`;
    for (const k of Object.keys(next)) if (k.startsWith(prefix)) delete next[k];
  }
  for (const g of delivered) {
    for (const it of g.items) {
      const k = keyOf(g.sourceName, it.url);
      if (next[k] === IN) continue;
      next[k] = it.stockStatus;
    }
  }
  return next;
}

export type StockChange = {
  key: string;
  from: string; // "ABSENT" = fanns inte förra körningen
  to: string;
  reason: "restock" | "sellout" | "ny-i-lager";
};

/**
 * Förändringar som MÅSTE väcka DB:n. Tom lista = säkert att hoppa (Neon sover).
 * `rotating` = namnen på roterande butiker (deras URL-tillkomst/-bortfall är brus).
 *
 * En källa som svarade TOMT bidrar med noll nycklar till `cur` och kan därför aldrig
 * generera en förändring — frånvaro är ingen signal. Att dess minne inte heller får
 * raderas är `mergeStateMap`s jobb (läs varför där).
 */
export function actionableChanges(
  prev: FeedStateMap,
  groups: FeedGroup[],
  rotating: Set<string>,
): StockChange[] {
  const cur = buildStateMap(groups);
  const changes: StockChange[] = [];
  for (const [k, to] of Object.entries(cur)) {
    const source = k.slice(0, k.indexOf("\t"));
    const from = prev[k];

    if (from === undefined) {
      // Ny URL. Roterande butik → rotation, inte signal. Icke-roterande + i lager →
      // möjlig ny produkt (feed-först-larm) → väck.
      if (!rotating.has(source) && to === IN) {
        changes.push({ key: k, from: "ABSENT", to, reason: "ny-i-lager" });
      }
      continue;
    }

    // Verklig lagerflipp på en URL vi såg BÅDA gångerna. Båda måste vara IN/OOS
    // (UNKNOWN räknas aldrig — speglar isRealStockTransition).
    const bothReal = (from === IN || from === OOS) && (to === IN || to === OOS);
    if (from !== to && bothReal) {
      changes.push({ key: k, from, to, reason: from === OOS ? "restock" : "sellout" });
    }
  }
  return changes;
}
