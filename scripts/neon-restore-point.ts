/**
 * Skapar en ÅTERSTÄLLNINGSPUNKT i Neon (en gren från en tidpunkt) och rapporterar hur
 * långt tillbaka historiken faktiskt räcker.
 *
 * VARFÖR: git kan inte ångra en DB-skrivning. 2026-07-14 skrev katalogverktygen i prod
 * på tre sätt ingen revert når (10 produkter mergade, 4 raderade, 18 CM-länkar ompekade),
 * och purge-corrupt-snapshots kan radera prishistorik. En Neon-gren är en zero-copy
 * ögonblicksbild — den åldras inte ur retention-fönstret och kostar nästan ingenting.
 *
 * NEON_API_KEY läses ur .env och skickas som Bearer-token. Den SKRIVS ALDRIG UT.
 *
 * Kör:  npx tsx -r dotenv/config scripts/neon-restore-point.ts            (bara läge/status)
 *       npx tsx -r dotenv/config scripts/neon-restore-point.ts --create   (skapa grenen)
 */
import "dotenv/config";

const KEY = process.env.NEON_API_KEY ?? "";
const CREATE = process.argv.includes("--create");
const API = "https://console.neon.tech/api/v2";

const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`Neon ${init?.method ?? "GET"} ${path} → HTTP ${r.status}: ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : {};
};

async function main() {
  if (!KEY) {
    console.error("NEON_API_KEY saknas i .env. Skapa en på console.neon.tech → Account settings → API keys.");
    process.exit(1);
  }
  // Sanity: dotenv strippar citattecken själv, men säg till om något ändå smet med.
  if (/^["']|["']$/.test(KEY)) {
    console.error("NEON_API_KEY innehåller citattecken — ta bort dem i .env.");
    process.exit(1);
  }
  console.log(`NEON_API_KEY: hittad (${KEY.length} tecken, börjar "${KEY.slice(0, 5)}…") — skrivs aldrig ut i klartext.\n`);

  // Neon kräver numera org_id på /projects. Hämta organisationerna först och slå ihop
  // projekten från alla (ett personkonto har oftast exakt en).
  const orgs = (await api("/users/me/organizations")).organizations ?? [];
  if (!orgs.length) {
    console.error("Inga organisationer på kontot — kan inte lista projekt.");
    process.exit(1);
  }
  const projects: any[] = [];
  for (const o of orgs) {
    const r = await api(`/projects?org_id=${encodeURIComponent(o.id)}`);
    for (const p of r.projects ?? []) projects.push(p);
  }
  console.log(`Organisationer: ${orgs.map((o: any) => o.name).join(", ")}`);
  if (!projects.length) {
    console.error("Inga Neon-projekt hittades.");
    process.exit(1);
  }

  for (const p of projects) {
    const hours = p.history_retention_seconds / 3600;
    console.log(`Projekt: ${p.name}  (id ${p.id}, ${p.region_id})`);
    console.log(`  Historik-retention: ${hours} h  → point-in-time-återställning möjlig ${hours} h tillbaka`);

    const { branches } = await api(`/projects/${p.id}/branches`);
    console.log(`  Grenar (${branches.length}):`);
    for (const b of branches)
      console.log(`    - ${b.name}${b.default ? " (default)" : ""}  skapad ${b.created_at.slice(0, 19).replace("T", " ")}`);

    if (!CREATE) continue;

    const parent = branches.find((b: any) => b.default) ?? branches[0];
    // Så långt tillbaka historiken RÄCKER, minus en marginal — det är den äldsta punkt
    // vi kan nå, alltså den som säkrast ligger FÖRE dagens katalogskrivningar.
    const oldest = new Date(Date.now() - (p.history_retention_seconds - 300) * 1000);
    const name = `restore-${oldest.toISOString().slice(0, 10)}-pre-catalog-writes`;

    if (branches.some((b: any) => b.name === name)) {
      console.log(`\n  Grenen "${name}" finns redan — gör inget.`);
      continue;
    }

    console.log(`\n  Skapar gren "${name}" från ${oldest.toISOString()} (äldsta nåbara punkt)…`);
    const created = await api(`/projects/${p.id}/branches`, {
      method: "POST",
      body: JSON.stringify({
        branch: { name, parent_id: parent.id, parent_timestamp: oldest.toISOString() },
      }),
    });
    console.log(`  ✔ Gren skapad: ${created.branch.name}  (id ${created.branch.id})`);
    console.log(`    Den åldras INTE ur retention-fönstret. Återställ via Neon-konsolen eller`);
    console.log(`    peka DATABASE_URL på grenens connection string.`);
  }

  if (!CREATE) console.log("\n(Bara status. Kör med --create för att skapa återställningspunkten.)");
}

main().catch((e) => {
  console.error(String(e).slice(0, 300));
  process.exit(1);
});
