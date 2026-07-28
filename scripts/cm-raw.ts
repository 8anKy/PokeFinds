/**
 * SPARA RAPIDAPI:S RÅA JSON till en fil du kan öppna — för ett kort eller ett helt set.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-raw.ts base1-4      # ETT kort (tcgid)
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-raw.ts Base         # HELA setet
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-raw.ts "Neo Destiny"
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-raw.ts --episodes    # lista alla set + id
 *
 * Filen skrivs till .cache/cm-raw/ som INDENTERAD JSON (radbruten, läsbar) — inget
 * är filtrerat eller omtolkat, det är exakt vad API:t svarade.
 *
 * Skriptet skriver också ut URL:en det anropade, så du kan klistra in samma
 * anrop i RapidAPI:s egen playground och klicka runt där i stället.
 *
 * KVOT: ett anrop per kort, eller ett per 20 kort i ett set (Base ≈ 16 anrop).
 * Kvoten är ~1600–3000/dygn och nollställs 12:59 UTC; skriptet skriver ut hur
 * mycket som är kvar efter varje anrop. Skriver ALDRIG ut nyckeln.
 */
// Läser nyckeln ur .env. (Skriptet rör inte databasen, så inget annat laddar den —
// utan den här raden blir CARDMARKET_RAPIDAPI_KEY tom och varje anrop svarar 401.)
import "dotenv/config";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
const OUT = join(process.cwd(), ".cache", "cm-raw");
const EPISODES_CACHE = join(process.cwd(), ".cache", "print-variants", "episodes.json");

const args = process.argv.slice(2);
const LIST = args.includes("--episodes");
const TERM = args.filter((a) => !a.startsWith("--")).join(" ").trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let remaining = "";
async function api<T>(url: string): Promise<T | null> {
  const r = await fetch(url, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
  remaining = r.headers.get("x-ratelimit-requests-remaining") ?? remaining;
  console.log(`  GET ${url.replace(`https://${HOST}`, "")}  → ${r.status}${remaining ? `  (kvot kvar ${remaining})` : ""}`);
  if (!r.ok) return null;
  return (await r.json()) as T;
}

const save = (name: string, data: unknown) => {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  const kb = (JSON.stringify(data).length / 1024).toFixed(0);
  console.log(`\nSparat: ${file}  (${kb} kB)`);
  return file;
};

async function episodes() {
  const list: { id: number; name: string; cards_total?: number }[] = [];
  let page = 1, total = 1;
  do {
    const d = await api<{ data: { id: number; name?: string; cards_total?: number }[]; paging?: { total?: number } }>(
      `https://${HOST}/pokemon/episodes?page=${page}`
    );
    if (!d) break;
    total = d.paging?.total ?? 1;
    list.push(...(d.data ?? []).map((e) => ({ id: e.id, name: e.name ?? "?", cards_total: e.cards_total })));
    await sleep(220);
  } while (page++ < total);
  mkdirSync(join(process.cwd(), ".cache", "print-variants"), { recursive: true });
  writeFileSync(EPISODES_CACHE, JSON.stringify(list.map(({ id, name }) => ({ id, name }))));
  return list;
}

async function main() {
  if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas i miljön (.env)");

  if (LIST) {
    const list = await episodes();
    save("episodes", list);
    console.log(`\n${list.length} set. De senaste:`);
    for (const e of list.slice(-15)) console.log(`  ${String(e.id).padStart(5)}  ${e.name}`);
    console.log(`\nAnvänd id:t: npx tsx scripts/cm-raw.ts --episode=<id>  eller setnamnet direkt.`);
    return;
  }
  if (!TERM) {
    console.log("Ange ett kort (tcgid, t.ex. base1-4) eller ett set (t.ex. Base). --episodes listar alla set.");
    return;
  }

  // tcgid ser ut som "base1-4", "sv3pt5-6", "swshp-SWSH085" → hämta kortet.
  if (/^[a-z0-9]+-[a-z0-9]+$/i.test(TERM) && !TERM.includes(" ")) {
    console.log(`Hämtar ETT kort (1 anrop):`);
    const body = await api<unknown>(`https://${HOST}/pokemon/cards?tcgid=${encodeURIComponent(TERM)}`);
    if (!body) return;
    save(TERM, body);
    console.log(`\nSamma anrop i RapidAPI:s playground:\n  GET https://${HOST}/pokemon/cards?tcgid=${TERM}`);
    return;
  }

  // Annars: ett helt set.
  const epArg = args.find((a) => a.startsWith("--episode="))?.split("=")[1];
  let id = epArg ? parseInt(epArg, 10) : NaN;
  let name = TERM;
  if (!Number.isFinite(id)) {
    const cached: { id: number; name: string }[] = existsSync(EPISODES_CACHE)
      ? JSON.parse(readFileSync(EPISODES_CACHE, "utf8"))
      : await episodes();
    const hits = cached.filter((e) => e.name.toLowerCase().includes(TERM.toLowerCase()));
    if (hits.length === 0) { console.log(`Inget set matchar "${TERM}". Kör --episodes för listan.`); return; }
    if (hits.length > 1) console.log(`Flera träffar: ${hits.map((h) => `${h.name} (${h.id})`).join(", ")} — tar första.`);
    id = hits[0].id; name = hits[0].name;
  }

  console.log(`Hämtar HELA setet "${name}" (episod ${id}):`);
  const first = await api<{ data: unknown[]; paging?: { total?: number } }>(
    `https://${HOST}/pokemon/episodes/${id}/cards?page=1`
  );
  if (!first) return;
  // Sidantalet läses ur SVARET — episodens `cards_total` ljuger (0 för flera set).
  const pages = Math.max(1, first.paging?.total ?? 1);
  const all = { episode: { id, name }, pages, data: [...(first.data ?? [])] };
  for (let pg = 2; pg <= pages; pg++) {
    const d = await api<{ data: unknown[] }>(`https://${HOST}/pokemon/episodes/${id}/cards?page=${pg}`);
    await sleep(220);
    if (d?.data?.length) all.data.push(...d.data);
  }
  save(name, all);
  console.log(
    `\n${all.data.length} rader (en per TRYCKNING — vintage-set har flera rader per kort).\n` +
    `Samma anrop i RapidAPI:s playground:\n  GET https://${HOST}/pokemon/episodes/${id}/cards?page=1`
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
