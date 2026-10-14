/**
 * MOTORLÄGETS FÄLTRAPPORT (2026-10-14) — skannermotorn är skannern för alla, Gemini av. Skuggrapporten
 * (scanner-shadow-report.ts) jämförde två skannrar; nu finns bara en, så måttet är vad användarna gjorde
 * med svaret. Samma mått räknas för perioden FÖRE bytet (dagens skanner) så talen går att ställa bredvid.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/scanner-engine-report.ts
 *   DAGAR=14 node scripts/with-prod-db.mjs npx tsx scripts/scanner-engine-report.ts
 *
 * Utfall per skanning med dom (userChosen):
 *   RÄTT ETTA  — bekräftad och kortet var listans etta
 *   UR LISTAN  — rättad/vald, och kortet fanns bland de sex första olika korten (valstegets platser)
 *   UTANFÖR    — rättad/sökt, kortet fanns INTE bland de sex
 *   RADERAD    — användaren tog bort skanningen (felbild, hand, eller ett fel vi inte kan döma)
 * ⛔ "Lägg till alla" (via:"bulk") är ett uteblivet klick, inte en granskning — redovisas separat.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DAYS = Number(process.env.DAGAR ?? "7");
const SWITCH = new Date("2026-10-14T18:54:00Z");

interface Row {
  shadow?: { primary?: boolean; numSwap?: string; err?: string };
  userChosen?: { cardId?: string | null; kind?: string; via?: string };
  recall?: { shown?: string[]; src?: string; nc?: boolean };
}

function firstDistinct(ids: string[], n: number): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (!out.includes(id)) out.push(id);
    if (out.length >= n) break;
  }
  return out;
}

function summarize(label: string, rows: Row[]) {
  const c = { scans: rows.length, noCard: 0, judged: 0, top1: 0, list: 0, outside: 0, rejected: 0, bulkTop1: 0, bulk: 0, numSwap: 0 };
  for (const r of rows) {
    if (r.recall?.nc) c.noCard++;
    if (r.shadow?.numSwap) c.numSwap++;
    const u = r.userChosen;
    if (!u?.kind) continue;
    const shown = r.recall?.shown ?? [];
    if (u.kind === "rejected") {
      c.judged++;
      c.rejected++;
      continue;
    }
    if (!u.cardId) continue;
    if (u.kind === "confirmed" && u.via === "bulk") {
      c.bulk++;
      if (shown[0] === u.cardId) c.bulkTop1++;
      continue;
    }
    c.judged++;
    if (u.kind === "confirmed" && shown[0] === u.cardId) c.top1++;
    else if (firstDistinct(shown, 6).includes(u.cardId)) c.list++;
    else c.outside++;
  }
  const p = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(1)} %` : "–");
  console.log(`\n=== ${label} ===`);
  console.log(`skanningar ${c.scans} · "inget kort" ${c.noCard} · telefonens nummer bytte ettan ${c.numSwap}`);
  console.log(
    `granskade (n=${c.judged}): rätt etta ${p(c.top1, c.judged)} · valt ur listan ${p(c.list, c.judged)} · ` +
      `utanför listan ${p(c.outside, c.judged)} · raderade ${p(c.rejected, c.judged)}`
  );
  console.log(`"Lägg till alla" (svagt, n=${c.bulk}): listans etta behölls ${p(c.bulkTop1, c.bulk)}`);
  // HUVUDTALET: alla domar ihop. Ettan "behölls" = bekräftad som etta (aktivt ELLER via Lägg till alla).
  const all = c.judged + c.bulk;
  const kept = c.top1 + c.bulkTop1;
  console.log(
    `ALLA DOMAR (n=${all}): ettan behölls ${p(kept, all)} · rättad ur listan ${p(c.list, all)} · ` +
      `rätt kort saknades ${p(c.outside, all)} · raderad ${p(c.rejected, all)}`
  );
}

async function main() {
  const now = Date.now();
  const afterFrom = new Date(Math.max(SWITCH.getTime(), now - DAYS * 864e5));
  const span = now - afterFrom.getTime();
  const beforeFrom = new Date(SWITCH.getTime() - Math.max(span, DAYS * 864e5));
  const jobs = await prisma.scannerJob.findMany({
    where: { createdAt: { gte: beforeFrom } },
    select: { result: true, createdAt: true },
  });
  const before: Row[] = [];
  const after: Row[] = [];
  let fallback = 0;
  for (const j of jobs) {
    const r = (j.result ?? {}) as Row;
    if (j.createdAt < SWITCH) before.push(r);
    else if (j.createdAt >= afterFrom) {
      after.push(r);
      if (r.recall && r.recall.src !== "engine") fallback++;
    }
  }
  summarize(`FÖRE bytet (dagens skanner, ${beforeFrom.toISOString().slice(0, 10)} → bytet)`, before);
  summarize(`MOTORN (${afterFrom.toISOString().slice(0, 16)} → nu)`, after);
  console.log(`motorn svarade inte (avtrycket ensamt avgjorde): ${fallback} av ${after.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
