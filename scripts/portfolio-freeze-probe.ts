/**
 * MÄTSOND (2026-10-13): rör sig portföljen UNDER Cardmarket-jobbets prissteg?
 *
 * Ägaren (tredje gången): "kl ~03:30 har portföljen uppdaterats medan CM-körningen
 * fortfarande pågår". Koden säger att värdet bara skrivs av frys-steget (~04:10 svensk
 * tid) — sonden bevisar det ena eller det andra i stället för att argumentera.
 *
 *   --save    (före prissteget)  räknar ägarkontonas portfölj och sparar i $RUNNER_TEMP
 *   --compare (före frys-steget) räknar igen och skriver BARA skillnaden i procent
 *
 * ⛔ Repot är publikt ⇒ Actions-loggen är publik. Inga belopp, inga id:n i loggen —
 *    bara "oförändrad" eller "+0,8 %". Beloppen stannar i runnerns tempkatalog.
 * Kostnad: körs i ett fönster där Neon redan är vaken (CM-jobbet) ⇒ noll väckningar.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prisma, ensureDbAwake } from "../src/lib/db";
import { exitJob } from "../src/lib/job-exit";
import { computeCollectionValue } from "../src/services/collection";

const file = join(process.env.RUNNER_TEMP || tmpdir(), "portfolio-freeze-probe.json");
const mode = process.argv.includes("--compare") ? "compare" : "save";

type Snapshot = { value: number; graph: number; movers: string };

async function measure(): Promise<Snapshot[]> {
  const owners = await prisma.user.findMany({
    where: { role: "SUPERADMIN" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const out: Snapshot[] = [];
  for (const o of owners) {
    const v = await computeCollectionValue(o.id);
    out.push({
      value: v.totalValue,
      graph: v.valueOverTime.reduce((s, p) => s + p.value, 0),
      movers: v.movers.map((m) => `${m.id}:${m.percent}`).join(","),
    });
  }
  return out;
}

const pct = (a: number, b: number) =>
  a === b ? "oförändrad" : `${b > a ? "+" : ""}${(((b - a) / (a || 1)) * 100).toFixed(2)} %`;

async function main() {
  await ensureDbAwake();
  const now = await measure();
  if (mode === "save") {
    writeFileSync(file, JSON.stringify(now));
    console.log(`[portfölj-sond] sparad för ${now.length} konto(n) före prissteget.`);
    return;
  }
  let before: Snapshot[];
  try {
    before = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.log("[portfölj-sond] ingen sparad mätning (steget före kördes inte) — hoppar.");
    return;
  }
  now.forEach((n, i) => {
    const b = before[i];
    if (!b) return;
    const moved = b.value !== n.value || b.graph !== n.graph || b.movers !== n.movers;
    console.log(
      `[portfölj-sond] konto ${i + 1}: totalvärde ${pct(b.value, n.value)}, ` +
        `graf ${pct(b.graph, n.graph)}, movers ${b.movers === n.movers ? "oförändrade" : "ÄNDRADE"}`
    );
    if (moved) console.log(`::warning::Portföljen rörde sig UNDER prissteget (före frysningen).`);
  });
}

main()
  .catch((e) => {
    // En mätsond får aldrig fälla jobbet.
    console.log(`[portfölj-sond] fel: ${e instanceof Error ? e.message : String(e)}`);
  })
  .finally(() => exitJob(0));
