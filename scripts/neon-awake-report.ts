/**
 * VARFÖR ÄR NEON-COMPUTEN VAKEN? — läser Neon-API:ts operations-logg och rekonstruerar
 * exakt när endpointen var uppe, hur länge, och vad som väckte den.
 *
 * Compute ÄR hela Neon-räkningen (Launch: $0.106/CU-timme). En vaken 0.25 CU-endpoint
 * dygnet runt = ~180 CU-h/mån ≈ $19. Frågan är alltså aldrig "hur många frågor kör vi"
 * utan "hur många FÖNSTER är computen uppe" — Launch kan inte somna snabbare än 5 min,
 * så varje väckning kostar minst 5 min × 0.25 CU oavsett hur liten frågan var.
 *
 * NEON_API_KEY läses ur .env och SKRIVS ALDRIG UT.
 *
 * Kör:  npx tsx -r dotenv/config scripts/neon-awake-report.ts [--days=3]
 */
import "dotenv/config";

const KEY = process.env.NEON_API_KEY ?? "";
const API = "https://console.neon.tech/api/v2";
const DAYS = Number(/--days=(\d+)/.exec(process.argv.join(" "))?.[1] ?? 3);

const api = async (path: string) => {
  const r = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" },
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path.split("?")[0]}: ${body.slice(0, 160)}`);
  return body ? JSON.parse(body) : {};
};

const hhmm = (d: Date) => d.toISOString().slice(11, 16);
const day = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  if (!KEY) {
    console.error("NEON_API_KEY saknas i .env.");
    process.exit(1);
  }
  const orgs = (await api("/users/me/organizations")).organizations ?? [];
  const projects: any[] = [];
  for (const o of orgs) for (const p of (await api(`/projects?org_id=${encodeURIComponent(o.id)}`)).projects ?? []) projects.push(p);
  const proj = projects.find((p) => /pokefinds/i.test(p.name)) ?? projects[0];
  console.log(`Projekt: ${proj.name} (${proj.id})\n`);

  // --- Endpoint-inställningar: autosuspend är hela hävstången ---
  const { endpoints } = await api(`/projects/${proj.id}/endpoints`);
  for (const e of endpoints ?? []) {
    console.log(
      `Endpoint ${e.id}: ${e.current_state}  autosuspend=${e.suspend_timeout_seconds ?? "default(300)"}s  ` +
        `min=${e.autoscaling_limit_min_cu} max=${e.autoscaling_limit_max_cu} CU`,
    );
  }
  console.log();

  // --- Operations-logg: paginera bakåt till vi passerat fönstret ---
  const since = new Date(Date.now() - DAYS * 864e5);
  const ops: any[] = [];
  let cursor = "";
  for (let page = 0; page < 60; page++) {
    const q = `/projects/${proj.id}/operations?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const r = await api(q);
    const batch = r.operations ?? [];
    if (!batch.length) break;
    ops.push(...batch);
    cursor = r.pagination?.cursor ?? "";
    const oldest = new Date(batch[batch.length - 1].created_at);
    if (!cursor || oldest < since) break;
  }
  const win = ops
    .filter((o) => new Date(o.created_at) >= since)
    .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));

  console.log(`Operations senaste ${DAYS} dygn: ${win.length}`);
  const byAction = new Map<string, number>();
  for (const o of win) byAction.set(o.action, (byAction.get(o.action) ?? 0) + 1);
  for (const [a, n] of [...byAction].sort((x, y) => y[1] - x[1])) console.log(`  ${String(n).padStart(5)} × ${a}`);
  console.log();

  // --- Rekonstruera vakna fönster (start_compute → suspend_compute) ---
  type Win = { start: Date; end: Date | null };
  const windows: Win[] = [];
  for (const o of win) {
    if (o.action === "start_compute" || o.action === "apply_config") {
      const last = windows[windows.length - 1];
      if (!last || last.end) windows.push({ start: new Date(o.created_at), end: null });
    } else if (o.action === "suspend_compute") {
      const last = windows[windows.length - 1];
      if (last && !last.end) last.end = new Date(o.updated_at ?? o.created_at);
      else windows.push({ start: since, end: new Date(o.updated_at ?? o.created_at) });
    }
  }
  const now = new Date();
  const perDay = new Map<string, number>();
  let total = 0;
  for (const w of windows) {
    const end = w.end ?? now;
    const mins = (+end - +w.start) / 6e4;
    if (mins <= 0) continue;
    total += mins;
    perDay.set(day(w.start), (perDay.get(day(w.start)) ?? 0) + mins);
  }

  console.log(`Vakna fönster: ${windows.length}, total vaken-tid ${(total / 60).toFixed(1)} h av ${DAYS * 24} h ` +
    `= ${((total / (DAYS * 1440)) * 100).toFixed(0)} %\n`);
  console.log("Per dygn:");
  for (const [d, mins] of [...perDay].sort()) {
    const pct = (mins / 1440) * 100;
    console.log(`  ${d}  ${(mins / 60).toFixed(1).padStart(5)} h  ${String(Math.round(pct)).padStart(3)} %  ` +
      `≈ ${((mins / 60) * 0.25).toFixed(1)} CU-h (vid 0.25 CU)  ${"█".repeat(Math.round(pct / 3))}`);
  }
  console.log();

  // --- De 40 senaste fönstren: längd + gap. Korta fönster i tät följd = väckningsläckage ---
  console.log("Senaste fönstren (längd = fakturerad tid, gap = sovtid före):");
  const tail = windows.slice(-40);
  for (let i = 0; i < tail.length; i++) {
    const w = tail[i];
    const end = w.end ?? now;
    const len = (+end - +w.start) / 6e4;
    const prev = tail[i - 1];
    const gap = prev?.end ? (+w.start - +prev.end) / 6e4 : NaN;
    console.log(
      `  ${day(w.start)} ${hhmm(w.start)}→${w.end ? hhmm(end) : "PÅGÅR"}  ` +
        `${len.toFixed(1).padStart(6)} min vaken   ${Number.isNaN(gap) ? "" : `(sov ${gap.toFixed(1)} min)`}`,
    );
  }
}

main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
