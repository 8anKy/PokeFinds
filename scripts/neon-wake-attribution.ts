/**
 * VILKEN TRAFIK KÖPER NEONS VAKNA TID? — attribuerar 5-minutersfönster till kategori.
 *
 * ⛔ RÄKNA VÄCKNINGAR, ALDRIG REQUESTS. Neon somnar först efter 300 s UTAN DB-arbete,
 * så måttet är: hur många 5-minutersluckor innehåller minst EN DB-rörande request, och
 * vilken kategori var ENSAM i luckan? En kategori som bara delar luckor med en annan
 * kostar INGENTING att ta bort — därav ENSAM-kolumnen. Det är skillnaden mellan att
 * spara pengar och att flytta runt statistik.
 *
 * Statiska filer, /api/health och robots.txt räknas som DB-FRIA (health har medvetet
 * ingen DB-fråga; se src/app/api/health/route.ts).
 *
 * Kör: npx tsx scripts/neon-wake-attribution.ts [--hours=24]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROJECT_ID = process.env.RAILWAY_PROJECT_ID ?? "cc604249-52e5-45df-9414-df8733a94cf9";
const HOURS = Number(/--hours=(\d+)/.exec(process.argv.join(" "))?.[1] ?? 24);
const BIN_MS = 300_000;

function readToken(): string {
  if (process.env.RAILWAY_TOKEN) return process.env.RAILWAY_TOKEN;
  const cfgPath = path.join(os.homedir(), ".railway", "config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const token = cfg?.user?.accessToken ?? cfg?.user?.token;
  if (!token) throw new Error("Ingen Railway-token.");
  return token;
}

async function gql<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data!;
}

interface Log {
  timestamp: string;
  clientUa: string;
  path: string;
  httpStatus: number;
  totalDuration: number;
  srcIp: string;
}

/** DB-FRIA vägar. Allt annat antas röra Neon (pessimistiskt med flit). */
const DB_FREE =
  /^\/(api\/health|robots\.txt|manifest\.json|favicon|icon-|apple-|brand\/|_next\/|sw\.js)|\.(png|jpg|jpeg|svg|ico|webp|css|js|txt)$/;

/** Kända, tillåtna sökmotorer. Googlebot/Bingbot får ALDRIG blockeras. */
const GOOD_BOT = /Googlebot|bingbot|DuckDuckBot|Discordbot|Twitterbot|facebookexternalhit|Slackbot/i;
/** Ser UA:n ut som en vanlig webbläsare? Distribuerade skrapare gömmer sig här. */
const BROWSERISH = /Mozilla\/5\.0.*(Chrome|Safari|Firefox|Edg)\//i;

function category(r: Log): string {
  const p = r.path ?? "";
  const ua = r.clientUa ?? "";
  if (DB_FREE.test(p)) return "db-fri (health/statisk)";
  if (p.startsWith("/api/scanner")) return "skanner (inloggad)";
  if (p.startsWith("/api/auth/session")) return "auth/session";
  if (p.startsWith("/api/collection") || p.startsWith("/api/watchlist") || p.startsWith("/api/set-watch"))
    return "inloggade API:er";
  if (p.startsWith("/api/track")) return "analytics (/api/track)";
  if (p.startsWith("/api/")) return "ovriga API:er";
  if (GOOD_BOT.test(ua)) return "sokmotor (Google/Bing)";
  if (/produkter\/|\/sets\//.test(p)) return BROWSERISH.test(ua) ? "katalogsida (webblasar-UA)" : "katalogsida (bot-UA)";
  return "ovriga sidor";
}

async function main() {
  const token = readToken();
  const dep = await gql<{ deployments: { edges: { node: { id: string } }[] } }>(
    token,
    `query($p:String!){ deployments(first:1, input:{projectId:$p}){ edges { node { id } } } }`,
    { p: PROJECT_ID }
  );
  const deploymentId = dep.deployments.edges[0].node.id;

  // Railway ger max ~5000 rader per anrop → sidbläddra bakåt från nu.
  const rows: Log[] = [];
  let anchor = new Date();
  const cutoff = new Date(Date.now() - HOURS * 3600_000);
  for (let page = 0; page < 12; page++) {
    const data = await gql<{ httpLogs: Log[] }>(
      token,
      `query($d:String!,$a:String!,$l:Int!,$f:String){
         httpLogs(deploymentId:$d, anchorDate:$a, beforeLimit:$l, afterLimit:0, filter:$f){
           timestamp clientUa path httpStatus totalDuration srcIp } }`,
      { d: deploymentId, a: anchor.toISOString(), l: 5000, f: "" }
    );
    const batch = data.httpLogs ?? [];
    if (!batch.length) break;
    rows.push(...batch);
    const oldest = batch.reduce((m, r) => Math.min(m, new Date(r.timestamp).getTime()), Infinity);
    if (!Number.isFinite(oldest) || oldest <= cutoff.getTime()) break;
    anchor = new Date(oldest - 1);
  }
  const kept = rows.filter((r) => new Date(r.timestamp).getTime() >= cutoff.getTime());
  if (!kept.length) {
    console.log("Inga rader.");
    return;
  }

  const times = kept.map((r) => new Date(r.timestamp).getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const spanH = (t1 - t0) / 3600_000;
  console.log(
    `${kept.length} rader over ${spanH.toFixed(1)} h (${new Date(t0).toISOString()} -> ${new Date(t1).toISOString()})`
  );

  const bins = new Map<number, Set<string>>();
  const catCount = new Map<string, number>();
  for (const r of kept) {
    const c = category(r);
    catCount.set(c, (catCount.get(c) ?? 0) + 1);
    if (c === "db-fri (health/statisk)") continue;
    const b = Math.floor(new Date(r.timestamp).getTime() / BIN_MS);
    if (!bins.has(b)) bins.set(b, new Set());
    bins.get(b)!.add(c);
  }
  const firstBin = Math.floor(t0 / BIN_MS);
  const lastBin = Math.floor(t1 / BIN_MS);
  const totalBins = lastBin - firstBin + 1;
  const awakeBins = bins.size;

  console.log(`\n=== VACKNINGSTRYCK ===`);
  console.log(
    `${awakeBins} av ${totalBins} femminutersluckor har DB-rorande trafik (${((awakeBins / totalBins) * 100).toFixed(1)} %).`
  );
  console.log(
    `Sovbara luckor: ${totalBins - awakeBins} (${(((totalBins - awakeBins) / totalBins) * 100).toFixed(1)} %).`
  );

  console.log(`\n=== KATEGORIER: requests, luckor, och luckor dar kategorin var ENSAM ===`);
  const cats = [...new Set([...bins.values()].flatMap((s) => [...s]))];
  const rowsOut = cats
    .map((c) => {
      const inBins = [...bins.values()].filter((s) => s.has(c)).length;
      const alone = [...bins.values()].filter((s) => s.size === 1 && s.has(c)).length;
      return { c, req: catCount.get(c) ?? 0, inBins, alone };
    })
    .sort((a, b) => b.alone - a.alone || b.inBins - a.inBins);
  console.log(
    `${"kategori".padEnd(30)} ${"req".padStart(6)} ${"luckor".padStart(7)} ${"ENSAM".padStart(6)}  <- ENSAM = luckor som forsvinner om kategorin tas bort`
  );
  for (const r of rowsOut) {
    console.log(
      `${r.c.padEnd(30)} ${String(r.req).padStart(6)} ${String(r.inBins).padStart(7)} ${String(r.alone).padStart(6)}   ~ ${((r.alone * 5) / 60).toFixed(1)} h sparad vaken tid`
    );
  }
  console.log(
    `${"db-fri (health/statisk)".padEnd(30)} ${String(catCount.get("db-fri (health/statisk)") ?? 0).padStart(6)} ${"-".padStart(7)} ${"-".padStart(6)}   (vacker aldrig)`
  );

  console.log(`\n=== LUCKOR MED DB-TRAFIK PER TIMME (UTC) ===`);
  const perHour = new Map<number, number>();
  for (const b of bins.keys()) {
    const h = new Date(b * BIN_MS).getUTCHours();
    perHour.set(h, (perHour.get(h) ?? 0) + 1);
  }
  for (let h = 0; h < 24; h++) {
    const n = perHour.get(h) ?? 0;
    if (n === 0 && !kept.some((r) => new Date(r.timestamp).getUTCHours() === h)) continue;
    console.log(`${String(h).padStart(2, "0")}:00  ${String(n).padStart(2)}/12  ${"#".repeat(n)}`);
  }

  // TANKEEXPERIMENT: en kategori som aldrig ar ENSAM sparar ingenting sjalv, men en
  // GRUPP kan gora det. Har raknas hur manga luckor som blir tomma om HELA gruppen
  // slutar rora DB:n (t.ex. alla sidrenders serveras ur cache utan Postgres).
  console.log(`\n=== SCENARIER: luckor som blir sovbara om en HEL GRUPP slutar rora DB:n ===`);
  const scenarios: { name: string; drop: string[] }[] = [
    { name: "Bara de forfalskade svepen (webblasar-UA pa katalog)", drop: ["katalogsida (webblasar-UA)"] },
    { name: "Alla botar utom Google/Bing", drop: ["katalogsida (webblasar-UA)", "katalogsida (bot-UA)"] },
    {
      name: "ALLA publika sidrenders DB-fria (cache/prerender)",
      drop: ["katalogsida (webblasar-UA)", "katalogsida (bot-UA)", "sokmotor (Google/Bing)", "ovriga sidor"],
    },
    {
      name: "Publika sidrenders + analytics DB-fria",
      drop: ["katalogsida (webblasar-UA)", "katalogsida (bot-UA)", "sokmotor (Google/Bing)", "ovriga sidor", "analytics (/api/track)"],
    },
    {
      name: "Allt utom inloggat (session/kollektion/skanner) och jobb",
      drop: ["katalogsida (webblasar-UA)", "katalogsida (bot-UA)", "sokmotor (Google/Bing)", "ovriga sidor", "analytics (/api/track)", "ovriga API:er"],
    },
    {
      name: "Ovanstaende + session-anropen slutar rora DB:n",
      drop: ["katalogsida (webblasar-UA)", "katalogsida (bot-UA)", "sokmotor (Google/Bing)", "ovriga sidor", "analytics (/api/track)", "ovriga API:er", "auth/session"],
    },
  ];
  for (const s of scenarios) {
    const kill = new Set(s.drop);
    const left = [...bins.values()].filter((set) => [...set].some((c) => !kill.has(c))).length;
    const freed = awakeBins - left;
    console.log(
      `${String(freed).padStart(3)} luckor frigjorda (~${((freed * 5) / 60).toFixed(1)} h/dygn)  ->  ${left}/${totalBins} luckor kvar (${((left / totalBins) * 100).toFixed(0)} %)   ${s.name}`
    );
  }

  // UA-listan: enda sattet att upptacka en NY namngiven crawler. ⛔ Las den EFTER
  // scenarierna ovan, aldrig fore — en UA hogst upp har kan kosta noll vaken tid.
  const byUa = new Map<string, { n: number; ips: Set<string>; cat: number; ms: number }>();
  for (const r of kept) {
    const e = byUa.get(r.clientUa) ?? { n: 0, ips: new Set<string>(), cat: 0, ms: 0 };
    e.n++;
    e.ms += r.totalDuration ?? 0;
    if (r.srcIp) e.ips.add(r.srcIp);
    if (/produkter\/|\/sets\//.test(r.path ?? "")) e.cat++;
    byUa.set(r.clientUa, e);
  }
  console.log(`\n=== UA-FORDELNING (topp 15 av ${byUa.size}) ===`);
  for (const [ua, e] of [...byUa.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 15)) {
    console.log(
      `${String(e.n).padStart(5)} ${((e.n / kept.length) * 100).toFixed(1).padStart(5)}%  ${Math.round(e.ms / 1000).toString().padStart(5)}s  ${String(e.ips.size).padStart(4)} ip  ${ua.slice(0, 95)}`
    );
  }

  console.log(`\n=== MISSTANKTA SVEP (>=10 IP:n, >=80 % katalogsidor) ===`);
  console.log("Manga IP:n + en enda UA + bara katalogsidor = svep, inte besokare.");
  for (const [ua, e] of [...byUa.entries()].sort((a, b) => b[1].n - a[1].n)) {
    if (e.ips.size >= 10 && e.cat / e.n >= 0.8) {
      console.log(
        `${String(e.n).padStart(5)} req  ${String(e.ips.size).padStart(4)} ip  ${(e.n / e.ips.size).toFixed(1)} req/ip  ${((e.cat / e.n) * 100).toFixed(0)}% katalog`
      );
      console.log(`      ${ua}`);
    }
  }
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exitCode = 1;
});
