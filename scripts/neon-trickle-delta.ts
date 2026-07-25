/**
 * VAD ÄR TRICKLEN? — mäter vilka frågor som faktiskt körs under ett tyst fönster.
 *
 * Neon Launch kan inte somna snabbare än 5 min. EN DB-rörande request var 5:e minut
 * räcker alltså för att hålla computen vaken dygnet runt — det är inte frågornas
 * TYNGD som kostar, det är deras SPRIDNING över dygnet. Den här mätningen tar två
 * pg_stat_statements-ögonblicksbilder med N sekunders mellanrum och visar deltat:
 * det som ökar under ett fönster utan batchjobb ÄR trickeln som betalar räkningen.
 *
 * Kör: node scripts/with-prod-db.mjs npx tsx scripts/neon-trickle-delta.ts [--seconds=300]
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const SECONDS = Number(/--seconds=(\d+)/.exec(process.argv.join(" "))?.[1] ?? 300);

type Row = { queryid: string; calls: number; rows: number; ms: number; query: string };

const sample = async (): Promise<Map<string, Row>> => {
  const rows = await db.$queryRawUnsafe<any[]>(`
    select queryid::text as queryid, calls::float8 as calls, rows::float8 as rows,
           round(total_exec_time)::float8 as ms, query
    from pg_stat_statements`);
  return new Map(rows.map((r) => [r.queryid, r as Row]));
};

const dbStats = async () =>
  (
    await db.$queryRawUnsafe<any[]>(
      `select xact_commit::float8 as commits, tup_returned::float8 as tup_returned,
              numbackends::float8 as backends
       from pg_stat_database where datname = current_database()`,
    )
  )[0];

async function main() {
  console.log(`Mäter ${SECONDS}s tyst fönster… (kör INTE andra jobb samtidigt)\n`);
  const a = await sample();
  const da = await dbStats();
  const t0 = Date.now();

  await new Promise((r) => setTimeout(r, SECONDS * 1000));

  const b = await sample();
  const dbb = await dbStats();
  const elapsed = (Date.now() - t0) / 1000;

  console.log(`Fönster: ${elapsed.toFixed(0)}s`);
  console.log(`Transaktioner: +${dbb.commits - da.commits}  (${((dbb.commits - da.commits) / (elapsed / 60)).toFixed(1)}/min)`);
  console.log(`Rader ut: +${dbb.tup_returned - da.tup_returned}\n`);

  const deltas: (Row & { dCalls: number; dRows: number; dMs: number })[] = [];
  for (const [id, nb] of b) {
    const na = a.get(id);
    const dCalls = nb.calls - (na?.calls ?? 0);
    if (dCalls <= 0) continue;
    deltas.push({ ...nb, dCalls, dRows: nb.rows - (na?.rows ?? 0), dMs: nb.ms - (na?.ms ?? 0) });
  }
  deltas.sort((x, y) => y.dCalls - x.dCalls);

  // Neons egen övervakning (neon.*, pg_catalog-sonder) räknas inte — den kör bara
  // NÄR computen redan är vaken och kan aldrig vara orsaken till att den väcktes.
  const isNoise = (q: string) =>
    /neon\.|pg_catalog|pg_stat|pg_settings|pg_database|pg_replication_slots|pg_is_in_recovery|^SELECT \$\d+$|current_database|pg_current_wal/i.test(q);

  const app = deltas.filter((d) => !isNoise(d.query));
  const noise = deltas.filter((d) => isNoise(d.query));

  console.log(`=== APP-FRÅGOR under fönstret (${app.length} distinkta) ===`);
  if (!app.length) console.log("  INGA. Computen hölls vaken av något annat än app-trafik.");
  for (const d of app.slice(0, 30))
    console.log(
      `  +${String(d.dCalls).padStart(5)} anrop  +${String(d.dRows).padStart(7)} rader  ` +
        `+${String(d.dMs).padStart(6)} ms | ${d.query.replace(/\s+/g, " ").slice(0, 120)}`,
    );

  console.log(`\n=== Neon-intern övervakning (${noise.length} distinkta, ${noise.reduce((s, d) => s + d.dCalls, 0)} anrop) ===`);
  console.log("  (kör bara när computen redan är vaken — aldrig orsaken)");
}

main()
  .catch((e) => {
    console.error(String(e).slice(0, 500));
    process.exit(1);
  })
  .finally(() => db.$disconnect());
