/**
 * SKUGGLÄGETS RAPPORT — skannermotorn utan AI mot dagens skanner, dömda mot användarnas val.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/scanner-shadow-report.ts
 *   DAGAR=14 node scripts/with-prod-db.mjs npx tsx scripts/scanner-shadow-report.ts
 *
 * Facit = `userChosen.cardId` för positiva domar (corrected/confirmed). ⛔ Håll domstyrkorna isär:
 * en rättelse (corrected) är starkt facit och anrikad med svåra fall, en bekräftelse via "Lägg till
 * alla" (via:"bulk") är ett uteblivet klick — rapporten skriver dem på egna rader.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DAYS = Number(process.env.DAGAR ?? "7");

interface Shadow { best: string | null; top: string[]; ms: number | null; err?: string }
interface Chosen { cardId?: string | null; kind?: string; via?: string }

async function main() {
  const since = new Date(Date.now() - DAYS * 864e5);
  const jobs = await prisma.scannerJob.findMany({
    where: { createdAt: { gte: since } },
    select: { result: true },
  });
  const rows = jobs
    .map((j) => j.result as { shadow?: Shadow; userChosen?: Chosen; recall?: { shown?: string[] } } | null)
    .filter((r): r is NonNullable<typeof r> => !!r?.shadow)
    // ⛔ MOTORLÄGE (shadow.primary): där VAR motorns svar det visade — `recall.shown` är då motorns
    // lista, inte dagens skanners. Sådana rader kan inte jämföra de två och räknas bort här.
    .filter((r) => !(r.shadow as Shadow & { primary?: boolean }).primary);
  const errors: Record<string, number> = {};
  for (const r of rows) if (r.shadow!.err) errors[r.shadow!.err] = (errors[r.shadow!.err] ?? 0) + 1;
  const ms = rows.map((r) => r.shadow!.ms).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  console.log(`\n=== SKUGGLÄGE, ${DAYS} dygn ===`);
  console.log(`skanningar med skuggsvar: ${rows.length} · fel: ${JSON.stringify(errors)} · tid median ${ms[ms.length >> 1] ?? "-"} ms, p90 ${ms[Math.floor(ms.length * 0.9)] ?? "-"} ms`);

  const buckets: [string, (c: Chosen) => boolean][] = [
    ["RÄTTADE (starkt facit)", (c) => c.kind === "corrected"],
    ["BEKRÄFTADE via aktivt val", (c) => c.kind === "confirmed" && c.via === "pick"],
    ["BEKRÄFTADE via Lägg till alla (svagt)", (c) => c.kind === "confirmed" && c.via === "bulk"],
  ];
  for (const [label, pick] of buckets) {
    const sub = rows.filter((r) => r.userChosen?.cardId && pick(r.userChosen) && !r.shadow!.err);
    if (!sub.length) {
      console.log(`${label}: n=0`);
      continue;
    }
    const truth = (r: (typeof sub)[number]) => r.userChosen!.cardId!;
    const engine1 = sub.filter((r) => r.shadow!.best === truth(r)).length;
    const engine5 = sub.filter((r) => r.shadow!.top.includes(truth(r))).length;
    const today1 = sub.filter((r) => r.recall?.shown?.[0] === truth(r)).length;
    const pct = (k: number) => `${((100 * k) / sub.length).toFixed(1)} %`;
    console.log(`${label} (n=${sub.length}): motorn etta ${pct(engine1)} · motorn topp-5 ${pct(engine5)} · dagens skanner etta ${pct(today1)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
