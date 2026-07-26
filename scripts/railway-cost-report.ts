/**
 * VAD KOSTAR RAILWAY, OCH VARFÖR? — läser Railways usage-API och räknar om
 * förbrukningen till kronor och ören per resurs.
 *
 * Railway fakturerar tre saker, och de är INTE lika stora. Mätt 2026-07-26 var
 * MINNE 92 % av notan ($2,97 av $3,24), egress 7 % och CPU 1 %. Att optimera
 * kod eller frågor sparar alltså ingenting här — minne faktureras per timme
 * containern är RESIDENT, inte per request. Kolla den här rapporten INNAN du
 * börjar optimera något, annars fixar du fel sak.
 *
 * ENHETERNA ÄR INTE SJÄLVKLARA (kalibrerade mot railway metrics 2026-07-26):
 *   MEMORY_USAGE_GB = GB-MINUTER   (inte GB, inte GB-timmar)
 *   CPU_USAGE       = vCPU-MINUTER
 *   NETWORK_TX_GB   = GB rakt av
 * Delar du GB-minuter med 43 800 (minuter/månad) får du snittet i GB.
 *
 * Token läses ur RAILWAY_TOKEN eller ur CLI:ns ~/.railway/config.json (kräver
 * `railway login`). Den SKRIVS ALDRIG UT.
 *
 * Kör:  npx tsx scripts/railway-cost-report.ts [--days=7]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Railways listpriser (Hobby/Pro). Ändras de här är hela rapporten fel — kolla
// mot railway.com/pricing om siffrorna plötsligt inte stämmer med fakturan.
const USD_PER_GB_MONTH = 10;
const USD_PER_VCPU_MONTH = 20;
const USD_PER_GB_EGRESS = 0.05;
const MINUTES_PER_MONTH = 730 * 60;

const PROJECT_ID = process.env.RAILWAY_PROJECT_ID ?? "cc604249-52e5-45df-9414-df8733a94cf9";

function readToken(): string {
  if (process.env.RAILWAY_TOKEN) return process.env.RAILWAY_TOKEN;
  const cfgPath = path.join(os.homedir(), ".railway", "config.json");
  if (!fs.existsSync(cfgPath)) {
    throw new Error("Ingen RAILWAY_TOKEN och ingen ~/.railway/config.json — kör `railway login`.");
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const token = cfg?.user?.accessToken ?? cfg?.user?.token;
  if (!token) throw new Error("Hittade ingen token i ~/.railway/config.json — kör `railway login` igen.");
  return token;
}

async function gql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`Railway-API: ${json.errors.map((e) => e.message).join("; ")}`);
  if (!json.data) throw new Error("Railway-API gav inget data-fält.");
  return json.data;
}

const MEASUREMENTS = ["MEMORY_USAGE_GB", "CPU_USAGE", "NETWORK_TX_GB"];

interface UsageRow {
  measurement: string;
  value: number;
}

async function usage(token: string, start: string, end: string): Promise<Record<string, number>> {
  const data = await gql<{ usage: UsageRow[] }>(
    token,
    `query($m:[MetricMeasurement!]!,$p:String,$s:DateTime!,$e:DateTime!){
       usage(measurements:$m, projectId:$p, startDate:$s, endDate:$e){ measurement value } }`,
    { m: MEASUREMENTS, p: PROJECT_ID, s: start, e: end }
  );
  return Object.fromEntries(data.usage.map((r) => [r.measurement, r.value]));
}

function costOf(u: Record<string, number>) {
  const memGbMin = u.MEMORY_USAGE_GB ?? 0;
  const cpuMin = u.CPU_USAGE ?? 0;
  const txGb = u.NETWORK_TX_GB ?? 0;
  const memory = (memGbMin / MINUTES_PER_MONTH) * USD_PER_GB_MONTH;
  const cpu = (cpuMin / MINUTES_PER_MONTH) * USD_PER_VCPU_MONTH;
  const egress = txGb * USD_PER_GB_EGRESS;
  return { memory, cpu, egress, total: memory + cpu + egress, memGbMin, cpuMin, txGb };
}

function line(label: string, c: ReturnType<typeof costOf>, days: number) {
  const avgGb = c.memGbMin / (days * 24 * 60);
  const avgCpu = c.cpuMin / (days * 24 * 60);
  console.log(
    `${label.padEnd(22)} $${c.total.toFixed(2).padStart(6)}   ` +
      `minne $${c.memory.toFixed(2).padStart(5)} (${avgGb.toFixed(3)} GB snitt)   ` +
      `cpu $${c.cpu.toFixed(2).padStart(4)} (${avgCpu.toFixed(4)} vCPU)   ` +
      `egress $${c.egress.toFixed(2).padStart(4)} (${c.txGb.toFixed(2)} GB)`
  );
}

async function main() {
  const daysArg = process.argv.find((a) => a.startsWith("--days="));
  const days = daysArg ? Math.max(1, parseInt(daysArg.split("=")[1], 10)) : 7;
  const token = readToken();
  const now = new Date();

  const period = await gql<{ me: { workspaces: { plan: string; customer: { billingPeriod: { start: string; end: string }; currentUsage: number } }[] } }>(
    token,
    `query{ me { workspaces { plan customer { billingPeriod { start end } currentUsage } } } }`,
    {}
  );
  const ws = period.me.workspaces[0];

  console.log(`Plan: ${ws.plan}`);
  console.log(
    `Faktureringsperiod: ${ws.customer.billingPeriod.start.slice(0, 10)} → ${ws.customer.billingPeriod.end.slice(0, 10)}`
  );
  console.log(`Railways egen siffra hittills i perioden: $${ws.customer.currentUsage.toFixed(2)}\n`);

  console.log("Period                    total   fördelning");
  console.log("─".repeat(118));

  const periodStart = new Date(ws.customer.billingPeriod.start);
  const periodDays = (now.getTime() - periodStart.getTime()) / 86400e3;
  line("innevarande period", costOf(await usage(token, periodStart.toISOString(), now.toISOString())), periodDays);

  for (let d = 1; d <= days; d++) {
    const end = new Date(now.getTime() - (d - 1) * 86400e3);
    const start = new Date(now.getTime() - d * 86400e3);
    line(`${start.toISOString().slice(0, 10)} (dygn)`, costOf(await usage(token, start.toISOString(), end.toISOString())), 1);
  }

  const dayCost = costOf(await usage(token, new Date(now.getTime() - 86400e3).toISOString(), now.toISOString()));
  console.log(
    `\nSenaste dygnet × 31 = $${(dayCost.total * 31).toFixed(2)}/månad i nuvarande takt.`
  );
  console.log(
    "Är minne >80 % av notan är svaret ALDRIG att optimera frågor — det är heap-taket\n" +
      "(NODE_OPTIONS i Dockerfile) eller App Sleeping som är kvar att skruva på."
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
