/**
 * VEM HÅLLER NEON VAKEN? — topplista ur pg_stat_statements + vem som är ansluten NU.
 *
 * Läs så här (från 2026-07-07-passet):
 *   - per `calls`            = väckningstryck (många små frågor dygnet runt = computen sover aldrig)
 *   - per `total_exec_time`  = compute-proxy
 *   - per `rows`             = egress-proxy
 * En fråga som körs var 30:e sekund kostar mer än en som skannar 400k rader en gång per dygn,
 * för Launch-planen kan inte somna snabbare än 5 min.
 *
 * Kör: node scripts/with-prod-db.mjs npx tsx scripts/neon-hot-queries.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const q = <T = any>(sql: string) => db.$queryRawUnsafe<T[]>(sql);

async function main() {
  const [{ current_database: dbname }] = await q<{ current_database: string }>("select current_database()");
  console.log(`DB: ${dbname}\n`);

  // --- Vem är ansluten just nu? Långlivade idle-in-transaction / aktiva pollers syns här ---
  console.log("=== ANSLUTNINGAR NU ===");
  const acts = await q(`
    select application_name, state, count(*)::int as n,
           max(now() - backend_start)::text as oldest_conn,
           max(now() - state_change)::text as longest_in_state
    from pg_stat_activity
    where backend_type = 'client backend' and pid <> pg_backend_pid()
    group by 1,2 order by n desc`);
  for (const a of acts)
    console.log(`  ${String(a.n).padStart(3)} × ${a.application_name || "(namnlös)"} [${a.state}]  äldsta ${a.oldest_conn}  i state ${a.longest_in_state}`);

  try {
    await q("create extension if not exists pg_stat_statements");
  } catch {
    /* kan redan finnas / saknas rättighet */
  }

  const has = await q<{ n: number }>("select count(*)::int as n from pg_extension where extname='pg_stat_statements'");
  if (!has[0]?.n) {
    console.log("\npg_stat_statements saknas — kan inte topplista. Aktivera i Neon-konsolen.");
    return;
  }

  const stats = await q(`select stats_since::text, now()::text as now from pg_stat_statements_info`).catch(() => []);
  if (stats[0]) console.log(`\npg_stat_statements samlar sedan ${stats[0].stats_since}`);

  const show = (title: string, rows: any[], fmt: (r: any) => string) => {
    console.log(`\n=== ${title} ===`);
    for (const r of rows) console.log(`  ${fmt(r)}  ${String(r.query).replace(/\s+/g, " ").slice(0, 130)}`);
  };

  show(
    "TOPP 20 PER ANTAL ANROP (väckningstryck)",
    await q(`select queryid, calls::bigint, round(total_exec_time)::bigint as ms, rows::bigint, query
             from pg_stat_statements where query not ilike '%pg_stat%' order by calls desc limit 20`),
    (r) => `${String(r.calls).padStart(9)} anrop  ${String(r.ms).padStart(9)} ms  ${String(r.rows).padStart(10)} rader |`,
  );

  show(
    "TOPP 15 PER EXEKVERINGSTID (compute)",
    await q(`select queryid, calls::bigint, round(total_exec_time)::bigint as ms, rows::bigint, query
             from pg_stat_statements where query not ilike '%pg_stat%' order by total_exec_time desc limit 15`),
    (r) => `${String(r.ms).padStart(9)} ms  ${String(r.calls).padStart(8)} anrop  ${String(r.rows).padStart(10)} rader |`,
  );

  show(
    "TOPP 15 PER RADER (egress)",
    await q(`select queryid, calls::bigint, rows::bigint, round(total_exec_time)::bigint as ms, query
             from pg_stat_statements where query not ilike '%pg_stat%' order by rows desc limit 15`),
    (r) => `${String(r.rows).padStart(11)} rader  ${String(r.calls).padStart(8)} anrop |`,
  );
}

main()
  .catch((e) => {
    console.error(String(e).slice(0, 500));
    process.exit(1);
  })
  .finally(() => db.$disconnect());
